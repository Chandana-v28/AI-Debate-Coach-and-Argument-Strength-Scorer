# Debatable. 
Debatable is a AI-powered debate opponent/coach which can help debate participants practice different prompts, hear rebuttals and get insights into what they are doing right and where they can improve. 

[Video Demo](https://www.loom.com/share/128d288d1ebe4e89bcef1091c16f86a1?sid=33d64e8d-ac5d-42af-9ed7-bd16b847df09).

## Prerequisites
- Node.js (v14 or higher)
- Python 3.8 or higher
- Groq API key

## Setup
1. Clone the repository:
```bash
git clone https://github.com/KrishDesai/debatable.
cd debatable.
```

2. Set up the backend:
```bash
cd server
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

3. Create a `.env` file in the server directory:
```
GROQ_API_KEY=your_groq_api_key_here
OPENAI_API_KEY=sk-your_openai_api_key_here
```

Both keys are supported. Groq handles fast rebuttals; OpenAI is preferred for analysis and scoring. If one provider fails, the app automatically falls back to the other.

Optional:
```
GROQ_CHAT_MODEL=llama-3.3-70b-versatile
OPENAI_CHAT_MODEL=gpt-4o-mini
OPENAI_BASE_URL=https://api.openai.com/v1
```

4. Set up the frontend:
```bash
cd ..
npm install
```

## Running the Application

1. Start the backend server:
```bash
cd server
uvicorn main:app --reload --port 8000
```

2. In a new terminal, start the frontend:
```bash
npm start
```

3. Open your browser and navigate to `http://localhost:3000`

## License
MIT
