# AI Debate Coach & Argument Strength Scorer

A full-stack web application designed to help users master the art of debate and refine their argumentation skills. Powered by the Google Gemini 1.5 Flash API.

## Features

1. **Argument Analyzer**: Paste any speech or argumentative text. The AI will extract logical fallacies, score your evidence strength (1-5), measure persuasiveness across ethos/pathos/logos, formulate three distinct counter-arguments, and provide an overall score.
2. **Real-Time Debate**: Go head-to-head with the AI on any topic. The AI will always argue the opposing side and provide real-time coaching tips, exposing logical weaknesses as you chat.
3. **Post-Debate Report**: After ending a debate, receive a detailed analysis of how your argument evolved, your strongest/weakest moments, and a final verdict from the AI judge.

## Tech Stack

- **Frontend**: React, Vite, Tailwind CSS (v4), React Router, Lucide-React.
- **Backend**: FastAPI, `google-generativeai` python SDK, Pydantic, Uvicorn.
- **AI Engine**: Google Gemini 1.5 Flash.

## Setup Instructions

### 1. Prerequisites
- Node.js (v18+)
- Python (3.9+)
- A Groq API Key

### 2. Backend Setup
Navigate into the `backend` directory from the root:
```bash
cd backend
```
Install the Python dependencies:
```bash
pip install -r requirements.txt
```
Ensure your `.env` file is properly configured with your API key:
```env
GROQ_API_KEY=your_groq_api_key_here
```
Run the FastAPI development server:
```bash
uvicorn main:app --reload
```
The API will be available at `http://localhost:8000`.

### 3. Frontend Setup
Open a new terminal window, and navigate into the `frontend` directory:
```bash
cd frontend
```
Install the Node dependencies:
```bash
npm install
```
Start the Vite development server:
```bash
npm run dev
```

Open your browser and navigate to the local URL provided by Vite (typically `http://localhost:5173`).

## Usage

- **Home Page**: Select between the two primary modes.
- **Argument Analyzer**: Enter your argument text and wait for the dashboard to render the full suite of metrics and fallacies.
- **Real-Time Debate**: Enter a controversial topic. You will begin the debate by sending your first message. Pay close attention to the "Coach's Tip" returned under each AI opponent response. When finished, hit "End Debate" to view your summary report.
