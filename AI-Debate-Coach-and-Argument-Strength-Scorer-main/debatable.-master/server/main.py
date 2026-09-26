import os
import json
import re
from fastapi import FastAPI, File, Form, UploadFile, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse
from groq import Groq
from dotenv import load_dotenv
from pathlib import Path
import requests
from typing import Optional, List
from pydantic import BaseModel, EmailStr, validator
import logging
import tempfile
import hashlib
import jwt
from datetime import datetime, timedelta
import sqlite3

# Load environment variables from the server .env file before importing modules that depend on them
dotenv_path = Path(__file__).resolve().parent / ".env"
load_dotenv(dotenv_path=dotenv_path)

from .api_manager import APIKeyManager, APICallHandler
from .oauth_auth import (
    FRONTEND_URL,
    exchange_apple_code,
    exchange_google_code,
    get_apple_auth_url,
    get_google_auth_url,
    get_or_create_oauth_user,
    oauth_providers_status,
    validate_oauth_state,
    verify_apple_id_token,
    verify_google_id_token,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Initialize multi-API key manager
api_manager = APIKeyManager()
api_handler = APICallHandler(api_manager)
api_manager.validate_providers()

# Backward compatibility - for code that checks `groq` directly
groq = api_manager.get_groq_client() if api_manager.has_groq_keys() else None
if not api_manager.has_any_keys():
    logger.warning("No Groq or OpenAI API keys found. Running in mock mode.")

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# JWT Configuration
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key-change-in-production")
ALGORITHM = "HS256"
TOKEN_EXPIRATION_HOURS = 24
DB_PATH = os.path.join(os.path.dirname(__file__), "debate_app.db")

def get_db_connection():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS users (
            username TEXT PRIMARY KEY,
            email TEXT NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            created_at TEXT NOT NULL
        )
        """
    )
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS debate_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            topic TEXT NOT NULL,
            transcription TEXT NOT NULL,
            rebuttal TEXT NOT NULL,
            analysis TEXT NOT NULL,
            score REAL NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            FOREIGN KEY (username) REFERENCES users (username)
        )
        """
    )
    user_columns = [row["name"] for row in cursor.execute("PRAGMA table_info(users)").fetchall()]
    if "password_hash" not in user_columns and "password" in user_columns:
        cursor.execute("ALTER TABLE users RENAME COLUMN password TO password_hash")
    if "auth_provider" not in user_columns:
        cursor.execute("ALTER TABLE users ADD COLUMN auth_provider TEXT NOT NULL DEFAULT 'local'")
    if "oauth_sub" not in user_columns:
        cursor.execute("ALTER TABLE users ADD COLUMN oauth_sub TEXT")
    if "created_at" not in user_columns:
        cursor.execute("ALTER TABLE users ADD COLUMN created_at TEXT")
        cursor.execute(
            """
            UPDATE users
            SET created_at = (
                SELECT MIN(created_at)
                FROM debate_history
                WHERE debate_history.username = users.username
            )
            WHERE created_at IS NULL OR created_at = ''
            """
        )
        cursor.execute(
            "UPDATE users SET created_at = ? WHERE created_at IS NULL OR created_at = ''",
            (datetime.now().isoformat(),),
        )

    history_columns = [row["name"] for row in cursor.execute("PRAGMA table_info(debate_history)").fetchall()]
    if "score" not in history_columns:
        cursor.execute("ALTER TABLE debate_history ADD COLUMN score REAL NOT NULL DEFAULT 0")
    if "archived" not in history_columns:
        cursor.execute("ALTER TABLE debate_history ADD COLUMN archived BOOLEAN NOT NULL DEFAULT 0")
    if "pinned" not in history_columns:
        cursor.execute("ALTER TABLE debate_history ADD COLUMN pinned BOOLEAN NOT NULL DEFAULT 0")
    if "renamed_topic" not in history_columns:
        cursor.execute("ALTER TABLE debate_history ADD COLUMN renamed_topic TEXT")
    if "session_id" not in history_columns:
        cursor.execute("ALTER TABLE debate_history ADD COLUMN session_id TEXT")
    conn.commit()
    conn.close()

init_db()

# Pydantic models
class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str

    @validator("email", pre=True)
    def normalize_email(cls, value: str) -> str:
        return value.strip().lower()

class LoginRequest(BaseModel):
    username: str
    password: str

class GoogleOAuthRequest(BaseModel):
    id_token: str

class DebateSettings(BaseModel):
    topic: str
    max_tokens: int = 1500

class UpdateTopicRequest(BaseModel):
    action: str  # 'rename', 'archive', 'unarchive', 'pin', 'unpin'
    new_name: Optional[str] = None  # For rename action

# Helper functions
def hash_password(password: str) -> str:
    """Hash password using SHA256"""
    return hashlib.sha256(password.encode()).hexdigest()

def create_token(username: str) -> str:
    """Create JWT token"""
    expires = datetime.now() + timedelta(hours=TOKEN_EXPIRATION_HOURS)
    payload = {
        "sub": username,
        "exp": expires
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def verify_token(token: str) -> Optional[str]:
    """Verify JWT token and return username"""
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username = payload.get("sub")
        return username
    except jwt.InvalidTokenError:
        return None

def get_user_profile(username: str) -> Optional[dict]:
    """Return public profile fields for a user."""
    conn = get_db_connection()
    try:
        user = conn.execute(
            "SELECT username, email, created_at FROM users WHERE username = ?",
            (username,),
        ).fetchone()
        if not user:
            return None
        return {
            "username": user["username"],
            "email": user["email"],
            "created_at": user["created_at"],
        }
    finally:
        conn.close()

def extract_username_from_auth(authorization: Optional[str], required: bool = True) -> Optional[str]:
    if not authorization:
        if required:
            raise HTTPException(status_code=401, detail="Authorization header missing")
        return None

    try:
        token = authorization.split(" ")[1]
    except IndexError:
        raise HTTPException(status_code=401, detail="Invalid authorization header")

    username = verify_token(token)
    if not username:
        raise HTTPException(status_code=401, detail="Invalid token")
    return username

def calculate_score(transcription: str, analysis: str) -> float:
    words = len(transcription.split())
    base = min(7.0, words / 35.0)
    penalty_keywords = ["weak", "unclear", "vague", "missing evidence", "unsupported"]
    penalties = sum(1 for keyword in penalty_keywords if keyword in analysis.lower())
    score = max(1.0, min(10.0, base + 3.0 - (penalties * 0.3)))
    return round(score, 1)

def complete_oauth_login(provider: str, oauth_profile: dict) -> dict:
    conn = get_db_connection()
    try:
        username, _created = get_or_create_oauth_user(
            conn,
            email=oauth_profile["email"],
            name=oauth_profile.get("name") or oauth_profile["email"].split("@")[0],
            provider=provider,
            oauth_sub=oauth_profile["sub"],
        )
    finally:
        conn.close()

    user_profile = get_user_profile(username)
    if not user_profile:
        raise HTTPException(status_code=500, detail="OAuth user profile not found")

    token = create_token(username)
    return {
        "token": token,
        **user_profile,
    }

def redirect_with_token(token: str) -> RedirectResponse:
    return RedirectResponse(url=f"{FRONTEND_URL}/?oauth_token={token}")

# Auth Endpoints
@app.post("/auth/register")
async def register(request: RegisterRequest):
    """Register a new user"""
    try:
        conn = get_db_connection()
        cursor = conn.cursor()
        existing = cursor.execute(
            "SELECT username FROM users WHERE username = ? OR email = ?",
            (request.username, request.email),
        ).fetchone()
        if existing:
            conn.close()
            raise HTTPException(status_code=400, detail="Username or email already exists")

        created_at = datetime.now().isoformat()
        cursor.execute(
            "INSERT INTO users (username, email, password_hash, created_at) VALUES (?, ?, ?, ?)",
            (
                request.username,
                request.email,
                hash_password(request.password),
                created_at,
            ),
        )
        conn.commit()
        conn.close()

        token = create_token(request.username)
        return {
            "token": token,
            "username": request.username,
            "email": request.email,
            "created_at": created_at,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Registration error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Registration failed: {str(e)}")

@app.post("/auth/login")
async def login(request: LoginRequest):
    """Login user"""
    try:
        conn = get_db_connection()
        row = conn.execute(
            "SELECT username, email, password_hash FROM users WHERE username = ?",
            (request.username,),
        ).fetchone()
        conn.close()

        if not row:
            raise HTTPException(status_code=401, detail="Invalid username or password")

        if row["password_hash"] != hash_password(request.password):
            raise HTTPException(status_code=401, detail="Invalid username or password")
        
        profile = get_user_profile(row["username"])
        if not profile:
            raise HTTPException(status_code=401, detail="Invalid username or password")

        token = create_token(request.username)
        return {
            "token": token,
            **profile,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Login error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Login failed: {str(e)}")

@app.get("/auth/me")
async def get_current_user(authorization: Optional[str] = Header(None)):
    """Get current user info"""
    username = extract_username_from_auth(authorization, required=True)
    profile = get_user_profile(username)
    if not profile:
        raise HTTPException(status_code=401, detail="Invalid token")

    return profile

@app.get("/auth/oauth/config")
async def oauth_config():
    """Return which social login providers are configured."""
    return oauth_providers_status()

@app.get("/auth/google/login")
async def google_login_redirect():
    """Redirect to Google account picker."""
    return RedirectResponse(url=get_google_auth_url())

@app.get("/auth/google/callback")
async def google_callback(code: Optional[str] = None, state: Optional[str] = None, error: Optional[str] = None):
    if error:
        return RedirectResponse(url=f"{FRONTEND_URL}/?oauth_error={error}")
    if not code:
        raise HTTPException(status_code=400, detail="Missing Google authorization code")
    validate_oauth_state(state)
    profile = exchange_google_code(code)
    auth_data = complete_oauth_login("google", profile)
    return redirect_with_token(auth_data["token"])

@app.post("/auth/google")
async def google_sign_in(request: GoogleOAuthRequest):
    """Sign in with Google ID token from the frontend popup flow."""
    profile = verify_google_id_token(request.id_token)
    return complete_oauth_login("google", profile)

@app.get("/auth/apple/login")
async def apple_login_redirect():
    """Redirect to Apple account sign-in."""
    return RedirectResponse(url=get_apple_auth_url())

@app.post("/auth/apple/callback")
async def apple_callback(
    code: Optional[str] = Form(None),
    id_token: Optional[str] = Form(None),
    state: Optional[str] = Form(None),
    error: Optional[str] = Form(None),
):
    if error:
        return RedirectResponse(url=f"{FRONTEND_URL}/?oauth_error={error}")
    validate_oauth_state(state)
    if id_token:
        profile = verify_apple_id_token(id_token)
    elif code:
        profile = exchange_apple_code(code)
    else:
        raise HTTPException(status_code=400, detail="Missing Apple authorization data")
    auth_data = complete_oauth_login("apple", profile)
    return redirect_with_token(auth_data["token"])

# generates the rebuttal
def get_debate_prompt(transcription: str, settings: DebateSettings) -> str:
    
    return f"""
    
    Topic: {settings.topic}
    User's Argument: "{transcription}"
    
    Structure your response in the following format:
    1. Opening Statement (1 sentence)
    2. Main Counterarguments (2 sentences)
    4. Closing Statement (1 sentence)
    
    Give your speech like you are presenting in front of someone (no titles, subheadings, etc.)
    """

#analyze the response by the user and the AI 
def get_analysis_prompt(transcription: str, rebuttal: str, topic: str) -> str:
    return f"""
    Analyze the following debate exchange and provide detailed feedback:

    Topic: {topic}
    User's Argument: "{transcription}"
    AI's Rebuttal: "{rebuttal}"

    Provide analysis in the following structure:

    Argument Strength Analysis
    - User's argument strengths
    - User's argument weaknesses
    - AI's rebuttal effectiveness

    Weak Points in User Argument
    - At least 3 specific weak points from the user's actual argument content
    - Explain why each weak point reduces persuasive impact

    Improvement Suggestions
    - Areas for improvement
    - Specific recommendations
    - Alternative approaches
    
    Keep the analysis constructive and focused on debate skills development.
    Use bullet points instead of asterisks (*).
    Do not use markdown formatting or special characters.
    DO NOT CUT OFF ANYTHING IN THE RESPONSE.
    """

#api endpoint
@app.post("/debate/full")
async def debate_full(
    audio: UploadFile = File(...),
    topic: str = Form(...),
    authorization: Optional[str] = Header(None),
):
    try:
        logger.info("Starting debate processing")
        
        if not topic.strip():
            raise HTTPException(status_code=400, detail="Topic cannot be empty")

        logger.info("Processing stt")
        audio_data = await audio.read()
        logger.info(f"Audio data size: {len(audio_data)} bytes, filename: {audio.filename}")
        
        # Determine file extension from filename
        file_extension = '.webm'
        if audio.filename:
            if audio.filename.endswith('.mp4'):
                file_extension = '.mp4'
            elif audio.filename.endswith('.wav'):
                file_extension = '.wav'
        
        with tempfile.NamedTemporaryFile(suffix=file_extension, delete=False) as temp_audio:
            temp_audio.write(audio_data)
            temp_audio_path = temp_audio.name

        try:
            if not api_manager.has_any_keys():
                # Mock transcription when no API key is available
                transcription = "This is a mock transcription. Please set valid GROQ_API_KEY and/or OPENAI_API_KEY to enable real speech-to-text conversion. Your spoken argument would be transcribed here."
                logger.info("Using mock transcription due to missing API keys")
            else:
                try:
                    with open(temp_audio_path, 'rb') as audio_file:
                        logger.info(f"Sending STT request with file: {temp_audio_path}")
                        transcription = api_handler.call_whisper_with_fallback(
                            audio_file=audio_file,
                            filename=audio.filename or f"recording{file_extension}",
                            file_extension=file_extension,
                            model="whisper-large-v3",
                            language="en",
                            max_retries=3
                        )
                    
                    # Validate transcription is not empty
                    if not transcription:
                        raise HTTPException(
                            status_code=400,
                            detail="No speech detected. Please speak clearly in English."
                        )
                    
                    logger.info(f"Transcription: {transcription}")
                except Exception as e:
                    logger.error(f"STT error: {str(e)}")
                    raise HTTPException(
                        status_code=400,
                        detail=f"Speech-to-text conversion failed: {str(e)}"
                    )
        finally:
            os.unlink(temp_audio_path)
   
        logger.info("Generating rebuttal")
        settings = DebateSettings(
            topic=topic
        )
        
        if not api_manager.has_any_keys():
            rebuttal = f"This is a mock rebuttal. Please set your GROQ_API_KEY and/or OPENAI_API_KEY to get real AI responses. Your argument about '{transcription[:50]}...' is interesting, but I would counter that there are several perspectives to consider on the topic of {topic}."
        else:
            try:
                prompt = get_debate_prompt(transcription, settings)
                response = api_handler.call_chat_with_fallback(
                    messages=[
                        {"role": "system", "content": "You are an intelligent debate opponent."},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.7,
                    max_tokens=settings.max_tokens,
                    prefer_openai=False,
                )
                rebuttal = response.choices[0].message.content.strip()
            except Exception as e:
                logger.error(f"Rebuttal generation error: {str(e)}")
                raise HTTPException(status_code=500, detail=f"Rebuttal generation failed: {str(e)}")
        
        logger.info(f"Rebuttal generated successfully. Length: {len(rebuttal)} characters")
        logger.info(f"Rebuttal preview: {rebuttal[:100]}...")
        
        logger.info("Generating analysis")
        if not api_manager.has_any_keys():
            analysis = (
                "Argument Strength Analysis\n"
                "- User's argument strengths: Clear stance and consistent tone.\n"
                "- User's argument weaknesses: Limited evidence, few concrete examples, and insufficient counterargument handling.\n"
                "- AI's rebuttal effectiveness: Addresses assumptions and offers broader perspective.\n\n"
                "Weak Points in User Argument\n"
                "- Evidence gap: Claims are asserted but not backed by specific facts.\n"
                "- Counterargument coverage: Opposing viewpoints are not directly refuted.\n"
                "- Depth of reasoning: Causal links are stated but not fully explained.\n\n"
                "Improvement Suggestions\n"
                "- Add one real-world example or statistic per main claim.\n"
                "- Anticipate one strong objection and rebut it directly.\n"
                "- Strengthen logical flow by linking each point to the final conclusion."
            )
        else:
            try:
                analysis_prompt = get_analysis_prompt(transcription, rebuttal, topic)
                analysis_response = api_handler.call_chat_with_fallback(
                    messages=[
                        {"role": "system", "content": "You are a debate analysis expert."},
                        {"role": "user", "content": analysis_prompt},
                    ],
                    temperature=0.7,
                    max_tokens=500,
                    prefer_openai=True,
                )
                analysis = analysis_response.choices[0].message.content.strip()
            except Exception as e:
                logger.error(f"Analysis generation error: {str(e)}")
                raise HTTPException(status_code=500, detail=f"Analysis generation failed: {str(e)}")
        
        logger.info("Analysis generated successfully")

        score = calculate_score(transcription, analysis)
        username = extract_username_from_auth(authorization, required=False)
        if username:
            conn = get_db_connection()
            conn.execute(
                """
                INSERT INTO debate_history (username, topic, transcription, rebuttal, analysis, score, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    username,
                    topic,
                    transcription,
                    rebuttal,
                    analysis,
                    score,
                    datetime.now().isoformat(),
                ),
            )
            conn.commit()
            conn.close()
        
        logger.info("Processing complete")
        return JSONResponse(
            content={
                "transcription": transcription,
                "rebuttal": rebuttal,
                "analysis": analysis,
                "score": score
            }
        )
        
    except Exception as e:
        logger.error(f"Error in debate processing: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/history")
async def get_history(authorization: Optional[str] = Header(None)):
    username = extract_username_from_auth(authorization, required=True)
    conn = get_db_connection()
    rows = conn.execute(
        """
        SELECT id, topic, transcription, rebuttal, analysis, score, created_at, archived, pinned, renamed_topic
        FROM debate_history
        WHERE username = ?
        ORDER BY pinned DESC, datetime(created_at) DESC
        """,
        (username,),
    ).fetchall()
    conn.close()
    return [dict(row) for row in rows]

@app.delete("/history/{debate_id}")
async def delete_debate(debate_id: int, authorization: Optional[str] = Header(None)):
    """Delete a debate entry"""
    username = extract_username_from_auth(authorization, required=True)
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Verify ownership
    debate = cursor.execute(
        "SELECT username FROM debate_history WHERE id = ?",
        (debate_id,)
    ).fetchone()
    
    if not debate or debate["username"] != username:
        conn.close()
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    cursor.execute("DELETE FROM debate_history WHERE id = ?", (debate_id,))
    conn.commit()
    conn.close()
    
    return {"message": "Debate deleted successfully"}

@app.put("/history/{debate_id}")
async def update_debate(debate_id: int, request: UpdateTopicRequest, authorization: Optional[str] = Header(None)):
    """Update debate: rename, archive, or pin"""
    username = extract_username_from_auth(authorization, required=True)
    conn = get_db_connection()
    cursor = conn.cursor()
    
    # Verify ownership
    debate = cursor.execute(
        "SELECT username FROM debate_history WHERE id = ?",
        (debate_id,)
    ).fetchone()
    
    if not debate or debate["username"] != username:
        conn.close()
        raise HTTPException(status_code=403, detail="Unauthorized")
    
    if request.action == "rename":
        if not request.new_name:
            raise HTTPException(status_code=400, detail="new_name required for rename")
        cursor.execute(
            "UPDATE debate_history SET renamed_topic = ? WHERE id = ?",
            (request.new_name, debate_id)
        )
    elif request.action == "archive":
        cursor.execute(
            "UPDATE debate_history SET archived = 1 WHERE id = ?",
            (debate_id,)
        )
    elif request.action == "unarchive":
        cursor.execute(
            "UPDATE debate_history SET archived = 0 WHERE id = ?",
            (debate_id,)
        )
    elif request.action == "pin":
        cursor.execute(
            "UPDATE debate_history SET pinned = 1 WHERE id = ?",
            (debate_id,)
        )
    elif request.action == "unpin":
        cursor.execute(
            "UPDATE debate_history SET pinned = 0 WHERE id = ?",
            (debate_id,)
        )
    else:
        conn.close()
        raise HTTPException(status_code=400, detail="Invalid action")
    
    conn.commit()
    conn.close()
    
    return {"message": f"Debate {request.action}ed successfully"}

class AnalyzeRequest(BaseModel):
    argument: str
    topic: Optional[str] = None

@app.post("/analyze")
async def analyze_argument(request: AnalyzeRequest, authorization: Optional[str] = Header(None)):
    """Analyze a quick argument using AI"""
    try:
        username = extract_username_from_auth(authorization, required=False)
        
        if not request.argument.strip():
            raise HTTPException(status_code=400, detail="Argument cannot be empty")
        
        argument = request.argument.strip()
        topic = request.topic.strip() if request.topic else ""
        topic_line = f'\nDebate Topic: "{topic}"' if topic else ""
        
        if not api_manager.has_any_keys():
            # Mock analysis when no API key
            analysis = f"""
Analysis Results:

Argument Quality Assessment:
- Length: {len(argument.split())} words
- Clarity: Good
- Persuasiveness: Moderate
- Structure: Well-organized

Strengths:
- Clear statement of position
- Coherent reasoning

Areas for Improvement:
- Add supporting evidence
- Include real-world examples
- Address potential counterarguments

Recommendations:
1. Strengthen with statistics or research
2. Provide concrete examples
3. Anticipate opposing viewpoints
4. Reinforce main thesis in conclusion
            """
        else:
            try:
                # Use Groq API for analysis with failover
                analysis_prompt = f"""
Analyze this debate argument and provide constructive feedback:

Argument: "{argument}"{topic_line}

Provide analysis in this format:
1. Argument Quality (Weak/Moderate/Strong)
2. Main Strengths (2-3 points)
3. Weaknesses (2-3 points)
4. Tone Analysis
5. Suggested Improvements (2-3 recommendations)
6. Overall Score (1-10)

Be constructive and specific. If a debate topic is provided, evaluate how well the argument addresses that topic.
                """
                
                response = api_handler.call_chat_with_fallback(
                    messages=[
                        {"role": "system", "content": "You are an expert debate argument analyzer. Provide clear, constructive feedback."},
                        {"role": "user", "content": analysis_prompt},
                    ],
                    temperature=0.7,
                    max_tokens=500,
                    prefer_openai=True,
                )
                analysis = response.choices[0].message.content.strip()
            except Exception as e:
                logger.error(f"Analysis error: {str(e)}", exc_info=True)
                raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")
        
        logger.info(f"Argument analyzed successfully")
        return JSONResponse(
            content={
                "analysis": analysis,
                "argument_length": len(argument.split()),
                "timestamp": datetime.now().isoformat()
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Analysis error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

class PracticeContentRequest(BaseModel):
    topic: str

@app.post("/practice-content")
async def generate_practice_content(request: PracticeContentRequest, authorization: Optional[str] = Header(None)):
    """Generate AI-generated facts and truth content for practice mode based on topic"""
    try:
        username = extract_username_from_auth(authorization, required=False)
        
        if not request.topic.strip():
            raise HTTPException(status_code=400, detail="Topic cannot be empty")
        
        topic = request.topic.strip()
        
        if not api_manager.has_any_keys():
            # Mock content when no API key
            facts = f"""Facts about "{topic}":

Facts are objective, verifiable information that cannot be logically denied. Research and identify:

1. Statistical Data: Look for quantifiable information, percentages, and numerical evidence related to {topic}.
2. Historical Events: Identify relevant past occurrences and their documented outcomes.
3. Scientific Evidence: Find peer-reviewed research, studies, and scientific consensus.
4. Expert Testimony: Gather statements from recognized authorities and specialists.
5. Legal Precedents: Review relevant court decisions and legal frameworks.
6. Published Reports: Use academic papers, government statistics, and institutional research.

These facts serve as the foundation for building a strong argument about {topic}."""

            truth = f"""Truth about "{topic}":

Truth represents your interpretation and conclusion derived from combining facts with logic. It's the broader meaning and significance.

1. Your Interpretation: How do you interpret the facts about {topic}? What do they mean?
2. Your Position: Based on the facts, what is your stance? What conclusion do you draw?
3. The Implications: What are the consequences or significance of {topic}?
4. Your Reasoning: How do the facts logically support your position?
5. The Narrative: Connect facts into a coherent story that supports your perspective on {topic}.
6. The Counter-perspective: Acknowledge opposing viewpoints and explain why your truth is more convincing.

Your truth claim should be debatable, well-reasoned, and grounded in the facts you've presented."""

            keypoints = f"""Debate key points for "{topic}":

• Define the resolution clearly — what exactly is being argued about {topic}?
• Identify the strongest pro and con positions before you pick a side.
• Separate facts (verifiable) from values (what ought to be) in this debate.
• List 3 claims you could defend and 3 claims opponents will likely use.
• Note which evidence types matter most: statistics, case studies, expert opinion, or ethics.
• Anticipate the weakest link in your argument and prepare a rebuttal.
• Plan one memorable example or analogy to make your position stick.
• End with a clear impact statement — why this debate matters to society or policy.
• Watch for common fallacies: straw man, false dilemma, appeal to emotion.
• Practice a 30-second opening that states your thesis in one sentence."""
        else:
            try:
                # Use Groq API to generate content with failover
                facts_prompt = f"""You are an expert debate coach. Generate comprehensive facts about the topic: "{topic}"

Provide 5-7 important facts about this topic. Each fact should be:
- Objective and verifiable
- Specific with numbers/dates where applicable
- Relevant to understanding the debate
- Written in a clear, educational manner

Format each fact as a separate paragraph. Focus on raw materials and evidence."""

                truth_prompt = f"""You are an expert debate coach. Generate truth/interpretation content about the topic: "{topic}"

Provide 5-7 truths or interpretations about this topic. Each truth should:
- Represent a possible conclusion or perspective
- Be based on logical reasoning
- Show how facts combine to form meaning
- Explain the broader implications
- Be written in an educational manner that guides the user

Format each truth as a separate paragraph. Explain how one might construct arguments from different perspectives on this topic."""

                keypoints_prompt = f"""You are an expert debate coach. For the debate topic "{topic}", provide 10-12 concise debate key points to help a student understand and prepare.

Each key point must be one clear sentence. Cover:
- how to frame the resolution
- main arguments for both sides
- critical definitions
- evidence to research
- common rebuttals
- rhetorical strategy
- pitfalls and fallacies to avoid

Format as a bullet list using "• " at the start of each line. No introduction paragraph."""

                # Generate facts with failover
                facts_response = api_handler.call_chat_with_fallback(
                    messages=[
                        {"role": "system", "content": "You are an expert debate coach helping students understand topics. Provide educational, factual, and balanced content."},
                        {"role": "user", "content": facts_prompt},
                    ],
                    temperature=0.7,
                    max_tokens=800,
                    prefer_openai=True,
                )
                facts = facts_response.choices[0].message.content.strip()

                truth_response = api_handler.call_chat_with_fallback(
                    messages=[
                        {"role": "system", "content": "You are an expert debate coach helping students understand topics. Provide educational content about how to interpret and construct arguments."},
                        {"role": "user", "content": truth_prompt},
                    ],
                    temperature=0.7,
                    max_tokens=800,
                    prefer_openai=True,
                )
                truth = truth_response.choices[0].message.content.strip()

                keypoints_response = api_handler.call_chat_with_fallback(
                    messages=[
                        {"role": "system", "content": "You are an expert debate coach. Output only bullet key points."},
                        {"role": "user", "content": keypoints_prompt},
                    ],
                    temperature=0.7,
                    max_tokens=700,
                    prefer_openai=True,
                )
                keypoints = keypoints_response.choices[0].message.content.strip()
            except Exception as e:
                logger.error(f"Practice content generation error: {str(e)}", exc_info=True)
                raise HTTPException(status_code=500, detail=f"Content generation failed: {str(e)}")
        
        logger.info(f"Practice content generated successfully for topic: {topic}")
        return JSONResponse(
            content={
                "facts": facts,
                "truth": truth,
                "keypoints": keypoints,
                "topic": topic,
                "timestamp": datetime.now().isoformat()
            }
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Practice content generation error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Content generation failed: {str(e)}")

class ExplainSelectionRequest(BaseModel):
    topic: str = ""
    selected_text: str
    context: Optional[str] = None


def _parse_keypoints_from_text(text: str) -> List[str]:
    lines = []
    for line in text.splitlines():
        cleaned = re.sub(r"^[\s\-\*•\d\.\)]+", "", line).strip()
        if len(cleaned) > 10:
            lines.append(cleaned)
    return lines[:12]


@app.post("/explain-selection")
async def explain_selection(request: ExplainSelectionRequest, authorization: Optional[str] = Header(None)):
    """Explain highlighted text with debate-focused key points (read-aloud companion)."""
    try:
        extract_username_from_auth(authorization, required=False)

        selected = request.selected_text.strip()
        if not selected:
            raise HTTPException(status_code=400, detail="No text selected")

        topic = (request.topic or "General debate").strip()
        context_snippet = (request.context or "")[:4000]

        if not api_manager.has_any_keys():
            summary = f"This passage relates to debating '{topic}' and highlights ideas you should clarify before arguing."
            keypoints = [
                f"Main idea: restate this passage in your own words before using it in a speech.",
                "Claim check: is this a fact, opinion, or value judgment?",
                "So what?: explain why this point matters to winning the debate.",
                "Evidence: what source or example would prove this point to a judge?",
                "Opposition: how might the other side attack this exact wording?",
                "Rebuttal prep: write one sentence to defend this point under cross-examination.",
                "Link back: connect this highlight to your overall thesis on the topic.",
            ]
        else:
            prompt = f"""The user highlighted this text while studying a debate on topic "{topic}":

HIGHLIGHTED TEXT:
\"\"\"{selected}\"\"\"

OPTIONAL CONTEXT (surrounding material):
\"\"\"{context_snippet}\"\"\"

Respond with ONLY valid JSON (no markdown fences) in this shape:
{{
  "summary": "one sentence explaining what this passage means in a debate",
  "keypoints": [
    "5 to 8 short bullet strings",
    "each helping the user understand how to use this text in a debate",
    "include: main claim, evidence needs, counterargument, rebuttal tip, definitions if needed"
  ]
}}"""

            try:
                response = api_handler.call_chat_with_fallback(
                    messages=[
                        {"role": "system", "content": "You are an expert debate coach. Return only valid JSON."},
                        {"role": "user", "content": prompt},
                    ],
                    temperature=0.5,
                    max_tokens=900,
                    prefer_openai=True,
                )
                raw = response.choices[0].message.content.strip()
                raw = re.sub(r"^```(?:json)?\s*", "", raw)
                raw = re.sub(r"\s*```$", "", raw)
                try:
                    parsed = json.loads(raw)
                    summary = parsed.get("summary", "")
                    keypoints = parsed.get("keypoints", [])
                except json.JSONDecodeError:
                    summary = "Key ideas from your highlighted passage for debate preparation."
                    keypoints = _parse_keypoints_from_text(raw)
            except Exception as e:
                logger.error(f"Explain selection error: {str(e)}", exc_info=True)
                raise HTTPException(status_code=500, detail=f"Explanation failed: {str(e)}")

        if isinstance(keypoints, str):
            keypoints = _parse_keypoints_from_text(keypoints)

        return JSONResponse(
            content={
                "summary": summary,
                "keypoints": keypoints,
                "topic": topic,
                "selected_text": selected,
                "timestamp": datetime.now().isoformat(),
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Explain selection error: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=f"Explanation failed: {str(e)}")


@app.get("/api/status")
async def api_status():
    """Get API configuration status"""
    return api_manager.get_status()


@app.get("/")
async def root():
    return {"message": "AI Debate Partner API is running"}