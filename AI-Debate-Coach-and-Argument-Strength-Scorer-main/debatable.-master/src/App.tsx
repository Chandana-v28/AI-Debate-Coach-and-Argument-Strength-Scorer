import React, { useState, useRef, useEffect, useMemo } from 'react';
import axios from 'axios';
import * as pdfjsLib from 'pdfjs-dist';
import * as mammoth from 'mammoth';
import './App.css';
import { DebateMode, getModeFromFlags, getModeLabel } from './modeUtils';

// Set up PDF.js worker with proper HTTPS URL
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.js`;

type DebateHistoryItem = {
  id: number;
  created_at: string;
  topic: string;
  transcription?: string;
  rebuttal?: string;
  analysis?: string;
  score?: number;
  rounds?: {
    roundNum: number;
    userArg: string;
    aiResponse: string;
    analysis: string;
  }[];
  [key: string]: any;
};

type User = {
  username: string;
  email: string;
  created_at?: string;
};

interface VoicePreset {
  id: string;
  name: string;
  gender: 'male' | 'female';
  description: string;
  pitch: number;
  rate: number;
  preferredVoices: string[];
}

const VOICE_PRESETS: VoicePreset[] = [
  {
    id: 'female-professional',
    name: 'Rain',
    gender: 'female',
    description: 'A crisp, professional, and articulate tone.',
    pitch: 1.05,
    rate: 1.0,
    preferredVoices: ['samantha', 'zira', 'google us english', 'karen', 'hazel', 'female']
  },
  {
    id: 'male-deep',
    name: 'Wave',
    gender: 'male',
    description: 'A deep, commanding tone, perfect for debate analysis.',
    pitch: 0.82,
    rate: 0.95,
    preferredVoices: ['david', 'google uk english male', 'daniel', 'alex', 'fred', 'male']
  },
  {
    id: 'female-gentle',
    name: 'Grove',
    gender: 'female',
    description: 'A warm, encouraging, and supportive tone.',
    pitch: 0.98,
    rate: 0.88,
    preferredVoices: ['samantha', 'google us english', 'zira', 'karen', 'hazel', 'female']
  },
  {
    id: 'male-friendly',
    name: 'Elm',
    gender: 'male',
    description: 'A friendly, engaging, and dynamic conversational tone.',
    pitch: 1.12,
    rate: 1.05,
    preferredVoices: ['google uk english male', 'alex', 'david', 'daniel', 'male']
  },
  {
    id: 'british-academic',
    name: 'Alder',
    gender: 'female',
    description: 'A formal British accent voice with a precise delivery.',
    pitch: 1.0,
    rate: 0.95,
    preferredVoices: ['google uk english female', 'daniel', 'karen', 'hazel', 'uk']
  }
];

function App() {
  const [topic, setTopic] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [transcription, setTranscription] = useState('');
  const [rebuttal, setRebuttal] = useState('');
  const [analysis, setAnalysis] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [liveTranscription, setLiveTranscription] = useState('');
  const [volume, setVolume] = useState(() => parseFloat(localStorage.getItem('voiceVolume') || '1.0'));
  const [selectedVoicePreset, setSelectedVoicePreset] = useState<string>(() => localStorage.getItem('selectedVoicePreset') || 'female-professional');
  const [customVoiceName, setCustomVoiceName] = useState<string>(() => localStorage.getItem('customVoiceName') || '');
  const [voicePitch, setVoicePitch] = useState<number>(() => parseFloat(localStorage.getItem('voicePitch') || '1.05'));
  const [voiceRate, setVoiceRate] = useState<number>(() => parseFloat(localStorage.getItem('voiceRate') || '1.0'));
  const [availableVoices, setAvailableVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [showAdvancedVoice, setShowAdvancedVoice] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authMode, setAuthMode] = useState<'register' | 'login'>('register');
  const [showHistory, setShowHistory] = useState(false);
  const [searchHistory, setSearchHistory] = useState<DebateHistoryItem[]>([]);
  const [loginForm, setLoginForm] = useState({ username: '', password: '' });
  const [registerForm, setRegisterForm] = useState({ email: '', username: '', password: '' });
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [equalizerActive, setEqualizerActive] = useState(false);
  const [currentPage, setCurrentPage] = useState<'dashboard' | 'debate' | 'history' | 'analytics' | 'settings'>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [profileData, setProfileData] = useState({ username: '', email: '', avatar: '' });
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  // Multi-round debate state
  const [debateRounds, setDebateRounds] = useState<{roundNum: number; userArg: string; aiResponse: string; analysis: string}[]>([]);
  const [debateActive, setDebateActive] = useState(false);
  const [debateSessionEnded, setDebateSessionEnded] = useState(false);
  const [currentRound, setCurrentRound] = useState(0);
  const [isPracticeMode, setIsPracticeMode] = useState(false);
  const [isLiveMode, setIsLiveMode] = useState(false);
  const activeMode = getModeFromFlags(isPracticeMode, isLiveMode);
  const [practiceArgument, setPracticeArgument] = useState('');
  const [factContent, setFactContent] = useState('');
  const [truthContent, setTruthContent] = useState('');
  const [keypointsContent, setKeypointsContent] = useState('');
  const [loadingPracticeContent, setLoadingPracticeContent] = useState(false);
  const [highlightedText, setHighlightedText] = useState('');
  const [selectionSummary, setSelectionSummary] = useState('');
  const [selectionKeypoints, setSelectionKeypoints] = useState<string[]>([]);
  const [loadingSelectionKeypoints, setLoadingSelectionKeypoints] = useState(false);
  const debateChatRef = useRef<HTMLDivElement>(null);
  const analyserTextareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Quick Argument Analyser state
  const [analysisText, setAnalysisText] = useState('');
  const [analysisResult, setAnalysisResult] = useState('');
  const [showAnalyserMenu, setShowAnalyserMenu] = useState(false);
  const [showRecentFiles, setShowRecentFiles] = useState(false);
  const [recentAnalyserFiles, setRecentAnalyserFiles] = useState<{name: string; date: Date}[]>([]);
  // Topic management state
  const [topicMenuId, setTopicMenuId] = useState<number | null>(null);
  const [showRenameModal, setShowRenameModal] = useState(false);
  const [renameTopicId, setRenameTopicId] = useState<number | null>(null);
  const [newTopicName, setNewTopicName] = useState('');
  const [selectedHistoryDebateId, setSelectedHistoryDebateId] = useState<number | null>(null);

  // Slide up results drawer states
  const [latestAnalysis, setLatestAnalysis] = useState<string>('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const touchStartY = useRef<number | null>(null);

  const setDebateMode = (mode: DebateMode) => {
    setIsPracticeMode(mode === 'practice');
    setIsLiveMode(mode === 'live');
  };

  const resetDebateSurface = () => {
    setTopic('');
    setDebateActive(false);
    setDebateSessionEnded(false);
    setDebateRounds([]);
    setCurrentRound(0);
    setPracticeArgument('');
    setFactContent('');
    setTruthContent('');
    setKeypointsContent('');
    setLatestAnalysis('');
    setHighlightedText('');
    setSelectionSummary('');
    setSelectionKeypoints([]);
    setDrawerOpen(false);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (touchStartY.current === null) return;
    const currentY = e.touches[0].clientY;
    const diff = touchStartY.current - currentY;
    if (diff > 50) { // Swiped up by 50px
      setDrawerOpen(true);
      touchStartY.current = null;
    } else if (diff < -50) { // Swiped down by 50px
      setDrawerOpen(false);
      touchStartY.current = null;
    }
  };

  const handleTouchEnd = () => {
    touchStartY.current = null;
  };

  const formatDateInKolkata = (dateValue: string | Date, options: Intl.DateTimeFormatOptions = {}) => {
    return new Date(dateValue).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', ...options });
  };

  const formatTimeInKolkata = (dateValue: string | Date, options: Intl.DateTimeFormatOptions = {}) => {
    return new Date(dateValue).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', ...options });
  };

  const fetchCurrentUser = async (): Promise<User | null> => {
    const token = localStorage.getItem('token');
    if (!token) return null;

    try {
      const response = await axios.get<User>('http://localhost:8000/auth/me', {
        headers: { Authorization: `Bearer ${token}` },
      });
      setCurrentUser(response.data);
      return response.data;
    } catch {
      localStorage.removeItem('token');
      setIsLoggedIn(false);
      setCurrentUser(null);
      return null;
    }
  };

  const synth = window.speechSynthesis;
  const computedStats = useMemo(() => {
    const allDebates = searchHistory;
    const totalDebates = allDebates.length;
    const debatesWithArgs = allDebates.filter((d: any) => d.transcription && d.transcription.trim().length > 10);
    const withArgumentsCount = debatesWithArgs.length;
    const wins = debatesWithArgs.filter((d: any) => (d.score || 0) >= 7.5).length;
    const winRate = withArgumentsCount > 0 ? Math.round((wins / withArgumentsCount) * 100) : 0;
    const averageScore = withArgumentsCount > 0
      ? Math.round((debatesWithArgs.reduce((s: number, d: any) => s + (d.score || 0), 0) / withArgumentsCount) * 10) / 10
      : 0;
    
    console.log('computedStats updated:', {
      totalDebates,
      withArgumentsCount,
      wins,
      winRate: `${winRate}%`,
      averageScore,
      sampleDebates: debatesWithArgs.slice(0, 2).map((d: any) => ({ topic: d.topic, score: d.score, transcription: d.transcription?.substring(0, 30) }))
    });
    
    return { totalDebates, withArgumentsCount, wins, winRate, averageScore };
  }, [searchHistory]);

  // Check if user is logged in on app load
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      fetchCurrentUser().then(user => {
        if (user) {
          setIsLoggedIn(true);
          loadSearchHistory();
        }
      });
    }
  }, []);

  useEffect(() => {
    if (currentUser) {
      setProfileData(prev => ({
        ...prev,
        username: currentUser.username,
        email: currentUser.email,
      }));
    }
  }, [currentUser?.username, currentUser?.email, currentUser?.created_at]);

  useEffect(() => {
    if (currentPage === 'settings' && isLoggedIn) {
      fetchCurrentUser();
    }
  }, [currentPage, isLoggedIn]);

  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      const x = ((event.clientX / window.innerWidth) - 0.5) * 28;
      const y = ((event.clientY / window.innerHeight) - 0.5) * 28;
      document.documentElement.style.setProperty('--cursor-x', `${x}px`);
      document.documentElement.style.setProperty('--cursor-y', `${y}px`);
    };

    window.addEventListener('mousemove', handleMouseMove);
    return () => window.removeEventListener('mousemove', handleMouseMove);
  }, []);

  // Activate equalizer on user interactions
  useEffect(() => {
    const activateEqualizer = () => {
      setEqualizerActive(true);
      setTimeout(() => setEqualizerActive(false), 2000);
    };

    const handleInteraction = () => activateEqualizer();
    
    window.addEventListener('click', handleInteraction);
    window.addEventListener('keydown', handleInteraction);
    
    return () => {
      window.removeEventListener('click', handleInteraction);
      window.removeEventListener('keydown', handleInteraction);
    };
  }, []);

  // initialize speech recognition
  useEffect(() => {
    if ('webkitSpeechRecognition' in window) {
      const recognition = new (window as any).webkitSpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';  // ← always English

      recognition.onresult = (event: any) => {
        const transcript = Array.from(event.results)
          .map((result: any) => result[0])
          .map((result) => result.transcript)
          .join('');
        setLiveTranscription(transcript);
      };

      recognition.onerror = (event: any) => {
        console.error('Speech recognition error:', event.error);
      };

      recognitionRef.current = recognition;
    }
  }, []);

  // Load and monitor speechSynthesis voices
  useEffect(() => {
    const updateVoices = () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        const voices = window.speechSynthesis.getVoices();
        setAvailableVoices(voices);
      }
    };
    
    updateVoices();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = updateVoices;
    }
  }, []);

  // Helper to match current voice settings to available voices
  const getSelectedVoice = (presetId: string, customName: string) => {
    const voices = window.speechSynthesis.getVoices();
    if (customName) {
      const match = voices.find(v => v.name === customName);
      if (match) return match;
    }
    
    const preset = VOICE_PRESETS.find(p => p.id === presetId);
    if (!preset) return null;
    
    // Attempt to match the preferred voices list
    for (const pref of preset.preferredVoices) {
      const match = voices.find(v => v.name.toLowerCase().includes(pref.toLowerCase()) && v.lang.startsWith('en'));
      if (match) return match;
    }
    
    // Fallback to the first available English voice
    const firstEngVoice = voices.find(v => v.lang.startsWith('en'));
    return firstEngVoice || null;
  };

  // Authentication functions
  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const response = await axios.post('http://localhost:8000/auth/login', loginForm);
      const token = response.data?.token || response.data?.access_token;
      if (!token) throw new Error('Token missing in login response');
      localStorage.setItem('token', token);

      setCurrentUser({
        username: response.data.username,
        email: response.data.email,
        created_at: response.data.created_at,
      });
      setIsLoggedIn(true);
      setLoginForm({ username: '', password: '' });
      loadSearchHistory();
    } catch (error: any) {
      alert(error.response?.data?.detail || 'Login failed');
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    const email = registerForm.email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      alert('Please enter a valid email address.');
      return;
    }
    try {
      const response = await axios.post('http://localhost:8000/auth/register', {
        ...registerForm,
        email: email.toLowerCase(),
      });
      const token = response.data?.token || response.data?.access_token;
      if (!token) throw new Error('Token missing in register response');
      localStorage.setItem('token', token);

      setCurrentUser({
        username: response.data.username,
        email: response.data.email,
        created_at: response.data.created_at,
      });
      setIsLoggedIn(true);
      setRegisterForm({ email: '', username: '', password: '' });
      loadSearchHistory();
    } catch (error: any) {
      alert(error.response?.data?.detail || 'Registration failed');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('token');
    setIsLoggedIn(false);
    setCurrentUser(null);
    setSearchHistory([]);
  };

  const loadSearchHistory = async () => {
    try {
      const token = localStorage.getItem('token');
      console.log('loadSearchHistory: token exists?', !!token, 'isLoggedIn?', isLoggedIn);
      if (!token) {
        console.log('loadSearchHistory: No token, skipping');
        return;  // not logged in, skip silently
      }
      console.log('loadSearchHistory: Making request to /history');
      const response = await axios.get('http://localhost:8000/history', {
        headers: { Authorization: `Bearer ${token}` }
      });
      console.log('loadSearchHistory: Got response, debates count:', response.data?.length || 0);
      console.log('loadSearchHistory: Response data:', response.data);
      if (Array.isArray(response.data)) {
        setSearchHistory(response.data);
        setShowHistory(true);
      } else {
        console.warn('loadSearchHistory: Response data is not an array', response.data);
        setSearchHistory([]);
      }
    } catch (error: any) {
      console.error('loadSearchHistory: ERROR:', error.message);
      if (error.response) {
        console.error('loadSearchHistory: Response error status:', error.response.status);
        console.error('loadSearchHistory: Response error data:', error.response.data);
      }
      setSearchHistory([]);  // Ensure state is set to empty array on error
    }
  };

  const handleAnalyserFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log('File upload handler called');
    if (!e.target.files) {
      console.log('No files selected');
      return;
    }
    
    const files = Array.from(e.target.files);
    console.log('Files selected:', files.length, files.map(f => ({ name: f.name, type: f.type })));

    files.forEach((file) => {
      console.log('Processing file:', file.name, 'Type:', file.type);
      
      if (file.type === 'application/pdf') {
        console.log('PDF file detected');
        // Extract text from PDF
        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
            console.log('PDF FileReader onload called');
            const arrayBuffer = event.target?.result as ArrayBuffer;
            const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
            let pdfText = '';
            
            for (let i = 1; i <= pdf.numPages; i++) {
              const page = await pdf.getPage(i);
              const textContent = await page.getTextContent();
              pdfText += textContent.items.map((item: any) => item.str).join(' ') + '\n';
            }
            
            console.log('PDF text extracted:', pdfText.substring(0, 100));
            setAnalysisText(prev => prev + `\n${pdfText}`);
            addToRecentFiles(file);
          } catch (error) {
            console.error('PDF processing error:', error);
            setAnalysisText(prev => prev + `\n[Error reading PDF ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}]`);
          }
        };
        reader.onerror = () => {
          console.error('FileReader error for:', file.name);
          setAnalysisText(prev => prev + `\n[Error reading ${file.name}]`);
        };
        console.log('Reading PDF as ArrayBuffer');
        reader.readAsArrayBuffer(file);
      } else if (file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || file.name.endsWith('.docx')) {
        console.log('DOCX file detected');
        // Extract text from DOCX
        const reader = new FileReader();
        reader.onload = async (event) => {
          try {
            console.log('DOCX FileReader onload called');
            const arrayBuffer = event.target?.result as ArrayBuffer;
            const result = await (mammoth as any).extractRawText({ arrayBuffer });
            console.log('DOCX text extracted:', result.value.substring(0, 100));
            setAnalysisText(prev => prev + `\n${result.value}`);
            addToRecentFiles(file);
          } catch (error) {
            console.error('DOCX processing error:', error);
            setAnalysisText(prev => prev + `\n[Error reading DOCX ${file.name}: ${error instanceof Error ? error.message : 'Unknown error'}]`);
          }
        };
        reader.onerror = () => {
          console.error('FileReader error for:', file.name);
          setAnalysisText(prev => prev + `\n[Error reading ${file.name}]`);
        };
        console.log('Reading DOCX as ArrayBuffer');
        reader.readAsArrayBuffer(file);
      } else if (file.type === 'application/msword' || file.name.endsWith('.doc')) {
        console.log('DOC file detected (not supported)');
        // DOC files - not supported
        setAnalysisText(prev => prev + `\n[Note: .doc files have limited support. Please convert to .docx or paste the text content]`);
      } else if (file.type.startsWith('image/')) {
        console.log('Image file detected');
        // For images, just add placeholder
        setAnalysisText(prev => prev + `\n[Image: ${file.name}]`);
        addToRecentFiles(file);
      } else if (file.type === 'text/plain' || file.type === 'application/json' || file.name.endsWith('.txt') || file.name.endsWith('.md')) {
        console.log('Text file detected');
        // Read text file content
        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const content = event.target?.result as string;
            console.log('Text file content read:', content.substring(0, 100));
            if (content) {
              setAnalysisText(prev => prev + `\n${content}`);
              addToRecentFiles(file);
            }
          } catch (error) {
            console.error('Text file processing error:', error);
          }
        };
        reader.onerror = () => {
          console.error('FileReader error for:', file.name);
          setAnalysisText(prev => prev + `\n[Error reading ${file.name}]`);
        };
        console.log('Reading text file');
        reader.readAsText(file);
      } else {
        console.log('Unsupported file format');
        // For unsupported file types
        setAnalysisText(prev => prev + `\n[Unsupported file format: ${file.name}. Please use PDF, DOCX, TXT, MD, JSON, or image files]`);
      }
    });
  };

  const addToRecentFiles = (file: File) => {
    const newFile = { name: file.name, date: new Date() };
    setRecentAnalyserFiles(prev => [newFile, ...prev.slice(0, 4)]);
  };

  const handleAnalyseArgument = async () => {
    if (!analysisText.trim()) {
      alert('Please enter an argument to analyze');
      return;
    }

    setIsLoading(true);
    try {
      // Analyze the argument using the Groq API via backend
      const response = await axios.post('http://localhost:8000/analyze', 
        {
          argument: analysisText
        },
        {
          headers: { 
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      setAnalysisResult(response.data.analysis || 'Analysis complete');
    } catch (error: any) {
      // Fallback analysis if API fails
      const textLength = analysisText.split(' ').length;
      const sentenceCount = analysisText.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
      const hasEvidence = analysisText.toLowerCase().includes('evidence') || analysisText.toLowerCase().includes('example') || analysisText.toLowerCase().includes('study') || analysisText.toLowerCase().includes('data');
      const hasLogicalFlow = sentenceCount >= 3;
      const hasConclusion = analysisText.toLowerCase().includes('therefore') || analysisText.toLowerCase().includes('conclude') || analysisText.toLowerCase().includes('in conclusion');
      
      let argumentQuality = 'Moderate';
      let score = 5.5;
      if (textLength > 100 && sentenceCount >= 4 && hasEvidence && hasLogicalFlow) {
        argumentQuality = 'Strong';
        score = 7.5 + (textLength > 200 ? 1.5 : 1);
      } else if (textLength > 50 && sentenceCount >= 2) {
        argumentQuality = 'Fair';
        score = 5.5 + (hasEvidence ? 1 : 0);
      } else {
        argumentQuality = 'Weak';
        score = 3.5;
      }
      score = Math.min(10, score);
      
      const strengths: string[] = [];
      const weaknesses: string[] = [];
      
      if (textLength > 50) strengths.push('Adequate length');
      if (hasEvidence) strengths.push('Includes evidence/examples');
      if (hasLogicalFlow) strengths.push('Good logical structure');
      if (hasConclusion) strengths.push('Clear conclusion');
      if (sentenceCount >= 4) strengths.push('Multiple supporting points');
      
      if (textLength < 30) weaknesses.push('Too brief - needs more detail');
      if (!hasEvidence) weaknesses.push('Lacks evidence or examples');
      if (sentenceCount < 2) weaknesses.push('Poor logical flow');
      if (!hasConclusion) weaknesses.push('Missing clear conclusion');
      if (textLength > 500 && sentenceCount < 5) weaknesses.push('Long but poorly structured');
      
      const result = `
Analysis Results:

📊 Argument Quality: ${argumentQuality}

⭐ Average Score: ${score.toFixed(1)}/10

✅ Main Strengths:
${strengths.length > 0 ? strengths.map(s => `• ${s}`).join('\n') : '• Consider adding more substance'}

⚠️ Weaknesses:
${weaknesses.length > 0 ? weaknesses.map(w => `• ${w}`).join('\n') : '• Well-constructed argument'}

💡 Suggestions:
• Add specific examples or statistics to strengthen claims
• Anticipate and address potential counterarguments
• Ensure clear logical progression from premise to conclusion
• Use varied sentence structure for better readability
      `;
      setAnalysisResult(result);
      console.error('Analysis error:', error);
    } finally {
      setIsLoading(false);
    }
  };;

  //speak to text with Web Speech API
  const speakText = (text: string) => {
    if (synth.speaking) {
      synth.cancel();
    }
    setIsPaused(false);
    
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Determine pitch and rate based on presets or overrides
    let finalPitch = voicePitch;
    let finalRate = voiceRate;
    
    if (selectedVoicePreset && !customVoiceName) {
      const preset = VOICE_PRESETS.find(p => p.id === selectedVoicePreset);
      if (preset) {
        finalPitch = preset.pitch;
        finalRate = preset.rate;
      }
    }
    
    utterance.rate = finalRate;
    utterance.pitch = finalPitch;
    utterance.volume = volume;
    utterance.voice = getSelectedVoice(selectedVoicePreset, customVoiceName);
    
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => {
      setIsSpeaking(false);
      setIsPaused(false);
    };
    utterance.onerror = () => {
      setIsSpeaking(false);
      setIsPaused(false);
    };
    
    synth.speak(utterance);
  };

  const pauseSpeech = () => {
    if (synth.speaking && !synth.paused) {
      synth.pause();
      setIsPaused(true);
    }
  };

  const resumeSpeech = () => {
    if (synth.paused) {
      synth.resume();
      setIsPaused(false);
    }
  };

  const stopSpeech = () => {
    if (synth.speaking || synth.paused) {
      synth.cancel();
      setIsSpeaking(false);
      setIsPaused(false);
    }
  };

  const clearTextSelection = () => {
    setHighlightedText('');
    setSelectionSummary('');
    setSelectionKeypoints([]);
    window.getSelection()?.removeAllRanges();
  };

  const captureTextSelection = (textarea?: HTMLTextAreaElement | null) => {
    if (textarea) {
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;
      if (start < end) {
        const text = textarea.value.substring(start, end).trim();
        if (text.length >= 3) {
          setHighlightedText(text);
          setSelectionSummary('');
          setSelectionKeypoints([]);
          return;
        }
      }
    }
    const sel = window.getSelection();
    const text = sel?.toString().trim() || '';
    if (text.length >= 3) {
      setHighlightedText(text);
      setSelectionSummary('');
      setSelectionKeypoints([]);
    }
  };

  const explainHighlightedText = async (debateTopic?: string) => {
    if (!highlightedText.trim()) return;

    setLoadingSelectionKeypoints(true);
    try {
      const context = isPracticeMode
        ? [factContent, truthContent, keypointsContent].filter(Boolean).join('\n\n')
        : analysisText;

      const response = await axios.post(
        'http://localhost:8000/explain-selection',
        {
          topic: debateTopic || topic || 'General debate',
          selected_text: highlightedText,
          context: context.slice(0, 4000),
        },
        {
          headers: {
            Authorization: `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json',
          },
        }
      );

      setSelectionSummary(response.data.summary || '');
      setSelectionKeypoints(Array.isArray(response.data.keypoints) ? response.data.keypoints : []);
    } catch (error) {
      console.error('Error explaining selection:', error);
      setSelectionSummary('Could not generate key points. Try again or check the server.');
      setSelectionKeypoints([
        'Restate the highlighted idea in one clear claim.',
        'Ask: is this a fact, opinion, or value judgment?',
        'List one piece of evidence that would support it.',
        'Predict how an opponent would attack this point.',
        'Write one sentence to defend it under rebuttal.',
      ]);
    } finally {
      setLoadingSelectionKeypoints(false);
    }
  };

  const renderSelectionAssist = (debateTopic?: string) => {
    if (!highlightedText) return null;

    const preview = highlightedText.length > 80
      ? `${highlightedText.slice(0, 80)}…`
      : highlightedText;

    return (
      <div className="selection-assist-panel">
        <div className="selection-assist-header">
          <span className="selection-assist-label">Selected:</span>
          <span className="selection-assist-preview">"{preview}"</span>
        </div>
        <div className="selection-assist-actions">
          <button
            type="button"
            className="selection-assist-btn read-btn"
            onClick={() => speakText(highlightedText)}
          >
            🔊 Read aloud
          </button>
          <button
            type="button"
            className="selection-assist-btn keypoints-btn"
            onClick={() => explainHighlightedText(debateTopic)}
            disabled={loadingSelectionKeypoints}
          >
            {loadingSelectionKeypoints ? '⏳ Generating…' : '💡 Debate key points'}
          </button>
          <button type="button" className="selection-assist-btn clear-btn" onClick={clearTextSelection}>
            ✕ Clear
          </button>
        </div>
        {(selectionSummary || selectionKeypoints.length > 0) && (
          <div className="selection-keypoints-result">
            {selectionSummary && <p className="selection-summary">{selectionSummary}</p>}
            {selectionKeypoints.length > 0 && (
              <ul className="selection-keypoints-list">
                {selectionKeypoints.map((point, idx) => (
                  <li key={idx}>{point}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    );
  };

  const parseAnalysis = (text: string) => {
    const lines = text.split('\n');
    const elements: React.ReactElement[] = [];
    let currentSubsection: string | null = null;
    let currentItems: string[] = [];
    let sectionKey = 0;

    const flushItems = () => {
      if (currentItems.length > 0) {
        const subsectionLower = currentSubsection?.toLowerCase() || '';
        const isStrength = subsectionLower.includes('strength') && !subsectionLower.includes('weakness');
        const isWeakness = subsectionLower.includes('weakness');
        const isImprovement = subsectionLower.includes('improvement') || 
                            subsectionLower.includes('suggestion') ||
                            subsectionLower.includes('recommendation');
        
        elements.push(
          <div key={`items-${sectionKey++}`} className={`analysis-items ${isStrength ? 'strength' : ''} ${isWeakness ? 'weakness' : ''} ${isImprovement ? 'improvement' : ''}`}>
            {currentItems.map((item, idx) => (
              <div key={idx} className="analysis-item">
                <span className="item-bullet">{isStrength ? '✓' : isWeakness ? '✗' : isImprovement ? '→' : '•'}</span>
                <span className="item-text">{item}</span>
              </div>
            ))}
          </div>
        );
        currentItems = [];
      }
    };

    lines.forEach((line) => {
      let trimmed = line.trim();
      
      trimmed = trimmed.replace(/\*\*/g, '').replace(/\*/g, '');

      if (!trimmed) {
        if (currentItems.length > 0) {
          flushItems();
        }
        return;
      }

      const mainSectionMatch = trimmed.match(/^(\d+\.\s*)?(Argument Strength Analysis|AI'?s rebuttal effectiveness|Improvement Suggestions|Areas for improvement|Specific recommendations)/i);
      if (mainSectionMatch) {
        flushItems();
        currentSubsection = null;
        const sectionTitle = trimmed.replace(/^\d+\.\s*/, '').trim();
        elements.push(
          <div key={`section-${sectionKey++}`} className="analysis-main-section">
            <h3 className="analysis-section-title">{sectionTitle}</h3>
          </div>
        );
        return;
      }

      let isBullet = false;
      let textWithoutBullet = trimmed;
      if (trimmed.startsWith('•') || trimmed.startsWith('-') || trimmed.startsWith('*') || /^[•\-*]\s/.test(trimmed)) {
        isBullet = true;
        textWithoutBullet = trimmed.replace(/^[•\-*]\s*/, '').trim();
      }

      const hasColon = textWithoutBullet.endsWith(':');
      const isShortLine = textWithoutBullet.length < 120;
      
      const explicitSubsectionPatterns = [
        /^areas? for improvement$/i,
        /^specific recommendations?$/i,
        /^user'?s argument (strengths?|weaknesses?)$/i,
        /^ai'?s rebuttal effectiveness$/i,
        /^improvement suggestions?$/i,
        /^alternative approaches?$/i
      ];
      
      const generalSubsectionPatterns = [
        /user'?s argument (strengths?|weaknesses?)/i,
        /ai'?s rebuttal effectiveness/i,
        /improvement suggestions?/i,
        /areas? for improvement/i,
        /specific recommendations?/i,
        /alternative approaches?/i,
        /(strengths?|weaknesses?|effectiveness|suggestions?|recommendations?|areas?|points?|issues?|approaches?):?$/i
      ];
      
      const isExplicitSubsection = explicitSubsectionPatterns.some(pattern => pattern.test(textWithoutBullet));
      const isGeneralSubsection = generalSubsectionPatterns.some(pattern => pattern.test(textWithoutBullet)) ||
                                 (hasColon && isShortLine) ||
                                 (textWithoutBullet.toLowerCase().includes("'s") && hasColon && isShortLine);

      if (isExplicitSubsection || (isGeneralSubsection && isShortLine)) {
        flushItems();
        currentSubsection = textWithoutBullet.replace(/:$/, '').trim();
        elements.push(
          <h4 key={`subsection-${sectionKey++}`} className="analysis-subsection">
            {textWithoutBullet}
          </h4>
        );
        return;
      }

      if (isBullet) {
        if (textWithoutBullet) {
          currentItems.push(textWithoutBullet);
        }
        return;
      }

      const explicitSubsectionCheck = [
        /^areas? for improvement$/i,
        /^specific recommendations?$/i,
        /^user'?s argument (strengths?|weaknesses?)$/i,
        /^ai'?s rebuttal effectiveness$/i,
        /^improvement suggestions?$/i,
        /^alternative approaches?$/i
      ].some(pattern => pattern.test(trimmed));
      
      const couldBeSubsection = explicitSubsectionCheck ||
                               (trimmed.length < 80 && 
                               trimmed.length > 3 &&
                               trimmed[0] === trimmed[0].toUpperCase() &&
                               !trimmed.includes('.') &&
                               !trimmed.includes(';') &&
                               !trimmed.match(/^[a-z]/) &&
                               (trimmed.split(' ').length <= 8) &&
                               (trimmed.toLowerCase().includes('strength') ||
                                trimmed.toLowerCase().includes('weakness') ||
                                trimmed.toLowerCase().includes('effectiveness') ||
                                trimmed.toLowerCase().includes('suggestion') ||
                                trimmed.toLowerCase().includes('recommendation') ||
                                trimmed.toLowerCase().includes('improvement') ||
                                trimmed.toLowerCase().includes('area') ||
                                trimmed.toLowerCase().includes('approach')));
      
      if (couldBeSubsection && currentItems.length > 0) {
        flushItems();
        currentSubsection = trimmed;
        elements.push(
          <h4 key={`subsection-${sectionKey++}`} className="analysis-subsection">
            {trimmed}
          </h4>
        );
      } else if (couldBeSubsection) {
        currentSubsection = trimmed;
        elements.push(
          <h4 key={`subsection-${sectionKey++}`} className="analysis-subsection">
            {trimmed}
          </h4>
        );
      } else {
        currentItems.push(trimmed);
      }
    });

    flushItems();
    return elements;
  };

  const releaseMicrophone = () => {
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((track) => track.stop());
      micStreamRef.current = null;
    }
  };

  const stopLiveSpeechRecognition = () => {
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.stop();
    } catch {
      // ignore if recognition was not running
    }
  };

  const getMicrophoneErrorMessage = (error: unknown): string => {
    const err = error as { name?: string; message?: string };
    switch (err.name) {
      case 'NotAllowedError':
      case 'PermissionDeniedError':
        return (
          'Microphone access was blocked.\n\n' +
          '1. Click the lock/site icon in the browser address bar\n' +
          '2. Set Microphone to "Allow"\n' +
          '3. Reload this page and try again'
        );
      case 'NotFoundError':
      case 'DevicesNotFoundError':
        return 'No microphone was found. Connect a mic or headset and try again.';
      case 'NotReadableError':
      case 'TrackStartError':
        return (
          'Microphone is in use by another app (Zoom, Teams, etc.).\n\n' +
          'Close other apps using the mic, then try again.'
        );
      case 'SecurityError':
        return 'Microphone requires a secure connection. Use http://localhost:3000 (not a network IP) or HTTPS.';
      case 'OverconstrainedError':
        return 'Your microphone does not support the required settings. Try a different device.';
      default:
        return err.message
          ? `Could not access microphone: ${err.message}`
          : 'Could not access microphone. Check browser permissions and try again.';
    }
  };

  const startLiveSpeechRecognition = () => {
    if (!recognitionRef.current) return;
    try {
      stopLiveSpeechRecognition();
      recognitionRef.current.start();
    } catch (e) {
      // Live captions are optional; recording still works via server transcription
      console.warn('Live speech recognition unavailable:', e);
    }
  };

  //stop recording 
  const handleStopRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      stopLiveSpeechRecognition();
      setIsRecording(false);
    }
    if (synth.speaking) {
      synth.cancel();
      setIsSpeaking(false);
    }
  };

  // Load AI-generated Facts and Truth content for practice mode
  const loadPracticeContent = async () => {
    if (!topic.trim()) {
      alert("Please enter a topic first.");
      return;
    }

    setLoadingPracticeContent(true);
    try {
      const response = await axios.post('http://localhost:8000/practice-content',
        { topic: topic },
        {
          headers: { 
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      setFactContent(response.data.facts || '');
      setTruthContent(response.data.truth || '');
      setKeypointsContent(response.data.keypoints || '');
    } catch (error) {
      console.error('Error loading practice content:', error);
      // Fallback content if API fails
      setFactContent(`Facts about "${topic}":\n\nFacts are objective, verifiable, and undisputed. They form the foundation of any strong argument. Research verified data, statistics, historical events, and scientific evidence related to "${topic}" to build a compelling case.`);
      setTruthContent(`Truth about "${topic}":\n\nTruth is the broader interpretation and conclusion you derive from these facts. It represents your claim and the meaning behind the evidence. Construct a coherent narrative that connects facts to show why your perspective on "${topic}" is valid and well-reasoned.`);
      setKeypointsContent(`Key debate prep points for "${topic}":\n\n• Define your resolution clearly.\n• List pro and con arguments.\n• Separate facts from opinions.\n• Prepare evidence and rebuttals.\n• Anticipate fallacies and weak spots.`);
    } finally {
      setLoadingPracticeContent(false);
    }
  };

  // Analyze practice argument and show results inline
  const handlePracticeAnalyze = async () => {
    if (!practiceArgument.trim()) {
      alert("Please enter an argument to analyze.");
      return;
    }

    setIsLoading(true);
    setLatestAnalysis('');
    try {
      const response = await axios.post('http://localhost:8000/analyze', 
        { argument: practiceArgument, topic: topic.trim() || undefined },
        {
          headers: { 
            'Authorization': `Bearer ${localStorage.getItem('token')}`,
            'Content-Type': 'application/json'
          }
        }
      );
      
      setLatestAnalysis(response.data.analysis || 'Analysis complete');
    } catch (error: any) {
      console.error('Error analyzing practice argument:', error);
      // Fallback analysis if API fails
      const textLength = practiceArgument.split(' ').length;
      const sentenceCount = practiceArgument.split(/[.!?]+/).filter(s => s.trim().length > 0).length;
      const hasEvidence = practiceArgument.toLowerCase().includes('evidence') || practiceArgument.toLowerCase().includes('example') || practiceArgument.toLowerCase().includes('study') || practiceArgument.toLowerCase().includes('data');
      const hasLogicalFlow = sentenceCount >= 3;
      const hasConclusion = practiceArgument.toLowerCase().includes('therefore') || practiceArgument.toLowerCase().includes('conclude') || practiceArgument.toLowerCase().includes('in conclusion');
      
      let argumentQuality = 'Moderate';
      let score = 5.5;
      if (textLength > 100 && sentenceCount >= 4 && hasEvidence && hasLogicalFlow) {
        argumentQuality = 'Strong';
        score = 7.5 + (textLength > 200 ? 1.5 : 1);
      } else if (textLength > 50 && sentenceCount >= 2) {
        argumentQuality = 'Fair';
        score = 5.5 + (hasEvidence ? 1 : 0);
      } else {
        argumentQuality = 'Weak';
        score = 3.5;
      }
      
      const strengths: string[] = [];
      const weaknesses: string[] = [];
      
      if (textLength > 50) strengths.push('Adequate length');
      if (hasEvidence) strengths.push('Includes evidence/examples');
      if (hasLogicalFlow) strengths.push('Good logical structure');
      if (hasConclusion) strengths.push('Clear conclusion');
      
      if (textLength < 30) weaknesses.push('Too brief - needs more detail');
      if (!hasEvidence) weaknesses.push('Lacks evidence or examples');
      if (!hasConclusion) weaknesses.push('Missing clear conclusion');

      const result = `
Argument Strength Analysis:
📊 Argument Quality: ${argumentQuality}
⭐ Average Score: ${score.toFixed(1)}/10

User's Argument Strengths:
${strengths.length > 0 ? strengths.map(s => `• ${s}`).join('\n') : '• Consider adding more substance'}

Areas for Improvement:
${weaknesses.length > 0 ? weaknesses.map(w => `• ${w}`).join('\n') : '• Well-constructed argument'}

Specific Recommendations:
• Add specific examples or statistics to strengthen claims
• Anticipate and address potential counterarguments
• Ensure clear logical progression from premise to conclusion
      `;
      setLatestAnalysis(result);
    } finally {
      setIsLoading(false);
    }
  };

  // End the entire debate session
  const handleStopDebateSession = () => {
    handleStopRecording();
    setDebateActive(false);
    setDebateSessionEnded(true);
  };

  const continueDebateFromHistory = (debate: DebateHistoryItem) => {
    const roundsFromHistory = debate.rounds && debate.rounds.length > 0
      ? debate.rounds
      : [{
          roundNum: 1,
          userArg: debate.transcription || '',
          aiResponse: debate.rebuttal || '',
          analysis: debate.analysis || '',
        }];

    setTopic(debate.topic || '');
    setDebateRounds(roundsFromHistory);
    setCurrentRound(roundsFromHistory.length);
    setDebateActive(true);
    setDebateSessionEnded(false);
    setDebateMode('live');
    setIsRecording(false);
    setIsLoading(false);
    setTranscription('');
    setRebuttal('');
    setAnalysis('');
    setLiveTranscription('');
    setLatestAnalysis('');
    setDrawerOpen(false);
  };

  const handleTopicAction = async (debateId: number, action: string, newName?: string) => {
    try {
      const token = localStorage.getItem('token');
      const payload: any = { action };
      if (newName) payload.new_name = newName;

      const response = await fetch(`http://localhost:8000/history/${debateId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        alert('Failed to update topic');
        return;
      }

      // Reload history
      loadSearchHistory();
      setTopicMenuId(null);
    } catch (error) {
      console.error('Error updating topic:', error);
      alert('Error updating topic');
    }
  };

  const handleDeleteDebate = async (debateId: number) => {
    if (!window.confirm('Are you sure you want to delete this debate?')) return;
    
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`http://localhost:8000/history/${debateId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (!response.ok) {
        alert('Failed to delete debate');
        return;
      }

      // Reload history
      loadSearchHistory();
      setTopicMenuId(null);
    } catch (error) {
      console.error('Error deleting debate:', error);
      alert('Error deleting debate');
    }
  };

  const handleRenameDebate = async (debateId: number) => {
    if (!newTopicName.trim()) {
      alert('Please enter a topic name');
      return;
    }
    await handleTopicAction(debateId, 'rename', newTopicName);
    setShowRenameModal(false);
    setNewTopicName('');
    setRenameTopicId(null);
  };

  //start recording 
  const handleStartRecording = async (isNewSession = false) => {
    if (!topic) {
      alert("Please enter a debate topic.");
      return;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
      alert('Recording is not supported in this browser. Use Chrome or Edge on desktop.');
      return;
    }

    if (isNewSession) {
      // Fresh session: reset everything
      setDebateRounds([]);
      setCurrentRound(0);
      setDebateSessionEnded(false);
      setLatestAnalysis('');
      setDrawerOpen(false);
    } else {
      setDrawerOpen(false);
    }

    setDebateMode('live');
    setDebateActive(true);
    setIsLoading(false);
    setTranscription('');
    setRebuttal('');
    setAnalysis('');
    setLiveTranscription('');

    releaseMicrophone();
    stopLiveSpeechRecognition();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      micStreamRef.current = stream;

      // Prefer webm; fall back to browser default if codec unsupported
      let mimeType = 'audio/webm';
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        mimeType = 'audio/mp4';
      } else if (MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')) {
        mimeType = 'audio/ogg;codecs=opus';
      }

      let mediaRecorder: MediaRecorder;
      try {
        mediaRecorder = MediaRecorder.isTypeSupported(mimeType)
          ? new MediaRecorder(stream, { mimeType })
          : new MediaRecorder(stream);
      } catch {
        mediaRecorder = new MediaRecorder(stream);
      }
      const recorderMimeType = mediaRecorder.mimeType || mimeType;

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];
      setIsRecording(true);

      // Start live captions only after mic is acquired (avoids mic conflict)
      startLiveSpeechRecognition();

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      mediaRecorder.onstop = async () => {
        stopLiveSpeechRecognition();
        setIsLoading(true);
        const audioBlob = new Blob(audioChunksRef.current, { 
          type: recorderMimeType
        });
        const formData = new FormData();
        const fileExtension = recorderMimeType.includes('mp4') ? 'mp4' : 
                             recorderMimeType.includes('wav') ? 'wav' : 'webm';
        formData.append('audio', audioBlob, `recording.${fileExtension}`);
        formData.append('topic', topic);


        try {
          console.log('Sending audio to server...', { mimeType: recorderMimeType, fileExtension, isLoggedIn });
          
          const token = localStorage.getItem('token');
          console.log('Token available?', !!token);
          
          const config = isLoggedIn && token ? {
            headers: { Authorization: `Bearer ${token}` }
          } : {};
          
          console.log('Axios config:', config);
          const response = await axios.post('http://localhost:8000/debate/full', formData, config);
          console.log('Debate submission response received');
          
          setTranscription(response.data.transcription);
          setRebuttal(response.data.rebuttal);
          setAnalysis(response.data.analysis);
          setLatestAnalysis(response.data.analysis || '');
          setDrawerOpen(true);

          // Push this exchange as a new round
          const roundNum = currentRound + 1;
          setCurrentRound(roundNum);
          setDebateRounds(prev => [...prev, {
            roundNum,
            userArg: response.data.transcription,
            aiResponse: response.data.rebuttal,
            analysis: response.data.analysis,
          }]);

          // Scroll chat to bottom
          setTimeout(() => {
            debateChatRef.current?.scrollTo({ top: debateChatRef.current.scrollHeight, behavior: 'smooth' });
          }, 100);

          // Speak the rebuttal
          speakText(response.data.rebuttal);

          // Refresh history so Analytics updates immediately
          console.log('About to load history, isLoggedIn?', isLoggedIn);
          if (isLoggedIn) {
            console.log('Calling loadSearchHistory after debate submission');
            // Add small delay to ensure database write is complete
            setTimeout(() => {
              loadSearchHistory();
            }, 500);
          } else {
            console.log('Not logged in, skipping loadSearchHistory');
          }
        } catch (error: any) {
          console.error('Error:', error);
          if (error.response) {
            console.error('Response data:', error.response.data);
            console.error('Response status:', error.response.status);
            alert(`Error: ${error.response.data?.detail || 'An error occurred while processing your debate. Please try again.'}`);
          } else {
            alert('An error occurred while processing your debate. Please try again.');
          }
        } finally {
          setIsLoading(false);
          setIsRecording(false);
          releaseMicrophone();
        }
      };

      mediaRecorder.start();
    } catch (error) {
      console.error('Error accessing microphone:', error);
      stopLiveSpeechRecognition();
      releaseMicrophone();
      mediaRecorderRef.current = null;
      setIsRecording(false);
      alert(getMicrophoneErrorMessage(error));
    }
  };

  //ui
  if (!isLoggedIn) {
    return (
      <div className="auth-container">
        <div className="auth-grid-bg"></div>
        <div className="auth-flowing-lines"></div>
        
        <div className="auth-layout">
          <div className="auth-left-panel">
            <div className="neural-network">
              <div className="network-node node-1"></div>
              <div className="network-node node-2"></div>
              <div className="network-node node-3"></div>
              <div className="network-node node-4"></div>
              <div className="network-line line-1"></div>
              <div className="network-line line-2"></div>
              <div className="network-line line-3"></div>
            </div>
            <div className="auth-left-content">
              <h1 className="auth-main-title">AI DEBATE COACH</h1>
              <p className="auth-tagline">Master the Art of Debate with AI</p>
              <p className="auth-description">Experience intelligent debate coaching with real-time feedback and strategic insights.</p>
            </div>
          </div>

          <div className="auth-right-panel">
            <div className="auth-glass-card">
              <div className="auth-header">
                <h2>{authMode === 'register' ? 'Create Account' : 'Welcome Back'}</h2>
                <p>{authMode === 'register' ? 'Start your debate journey' : 'Continue practicing'}</p>
              </div>

              <div className="auth-mode-toggle">
                <button 
                  className={authMode === 'register' ? 'active' : ''} 
                  onClick={() => setAuthMode('register')}
                  type="button"
                >
                  Register
                </button>
                <button 
                  className={authMode === 'login' ? 'active' : ''} 
                  onClick={() => setAuthMode('login')}
                  type="button"
                >
                  Login
                </button>
              </div>

              {authMode === 'register' ? (
                <form className="auth-form" onSubmit={handleRegister}>
                  <div className="form-group">
                    <input
                      type="text"
                      placeholder="Username"
                      value={registerForm.username}
                      onChange={e => setRegisterForm({...registerForm, username: e.target.value})}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <input
                      type="email"
                      placeholder="Email address"
                      value={registerForm.email}
                      onChange={e => setRegisterForm({...registerForm, email: e.target.value})}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <input
                      type="password"
                      placeholder="Password"
                      value={registerForm.password}
                      onChange={e => setRegisterForm({...registerForm, password: e.target.value})}
                      required
                    />
                  </div>
                  <button type="submit" className="auth-submit-btn">Create Account</button>
                </form>
              ) : (
                <form className="auth-form" onSubmit={handleLogin}>
                  <div className="form-group">
                    <input
                      type="text"
                      placeholder="Username"
                      value={loginForm.username}
                      onChange={e => setLoginForm({...loginForm, username: e.target.value})}
                      required
                    />
                  </div>
                  <div className="form-group">
                    <input
                      type="password"
                      placeholder="Password"
                      value={loginForm.password}
                      onChange={e => setLoginForm({...loginForm, password: e.target.value})}
                      required
                    />
                  </div>
                  <button type="submit" className="auth-submit-btn">Sign In</button>
                </form>
              )}

              <div className="auth-divider"></div>
              <div className="social-login">
                <button type="button" className="social-btn google">Google</button>
                <button type="button" className="social-btn apple">Apple</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Dashboard Page
  const renderDashboard = () => (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1 className="dashboard-title">Dashboard</h1>
        <p className="dashboard-subtitle">Welcome back, {currentUser?.username}! 👋</p>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <p className="stat-label">Total Debates</p>
            <p className="stat-value">{computedStats.totalDebates === 0 ? '—' : computedStats.totalDebates}</p>
            <p className="stat-sublabel">{computedStats.totalDebates === 0 ? 'No debates yet' : `Debate #${computedStats.totalDebates} completed`}</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">🎯</div>
          <div className="stat-content">
            <p className="stat-label">Win Rate</p>
            <p className="stat-value">{computedStats.withArgumentsCount === 0 ? '—' : `${computedStats.winRate}%`}</p>
            <p className="stat-sublabel">
              {computedStats.withArgumentsCount === 0
                ? 'No debates with arguments yet'
                : `${computedStats.wins} wins of ${computedStats.withArgumentsCount}`}
            </p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">⭐</div>
          <div className="stat-content">
            <p className="stat-label">Avg Score</p>
            <p className="stat-value">{computedStats.totalDebates === 0 ? '—' : `${computedStats.averageScore}/10`}</p>
            <p className="stat-sublabel">{computedStats.totalDebates === 0 ? 'No data yet' : 'Across all debates'}</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon">🔥</div>
          <div className="stat-content">
            <p className="stat-label">With Arguments</p>
            <p className="stat-value">{computedStats.totalDebates === 0 ? '—' : computedStats.withArgumentsCount}</p>
            <p className="stat-sublabel">{computedStats.totalDebates === 0 ? 'No debates yet' : 'Substantive debates'}</p>
          </div>
        </div>
      </div>

      <div className="action-buttons-grid">
        <button className="action-button primary" onClick={() => { setCurrentPage('debate'); setLatestAnalysis(''); setDrawerOpen(false); }}>
          <span className="button-icon">🎙️</span>
          <span className="button-text">Start Debate</span>
        </button>
        <button className="action-button secondary" onClick={() => { setCurrentPage('history'); loadSearchHistory(); setLatestAnalysis(''); setDrawerOpen(false); }}>
          <span className="button-icon">📜</span>
          <span className="button-text">View History</span>
        </button>
        <button className="action-button secondary" onClick={() => { setCurrentPage('debate'); setDebateMode('practice'); resetDebateSurface(); }}>
          <span className="button-icon">🎯</span>
          <span className="button-text">Practice Mode</span>
        </button>
      </div>

      <div className="recent-debates">
        <h2 className="section-title">Recent Debates</h2>
        <div className="debates-list">
          {searchHistory.length === 0 ? (
            <div className="empty-state">
              <p className="empty-icon">🎤</p>
              <p className="empty-title">No debates yet</p>
              <p className="empty-desc">Click "Start Debate" to begin your first debate session!</p>
            </div>
          ) : (
            searchHistory.slice(0, 5).map((item: any, index: number) => (
              <div key={item.id} className="debate-item">
                <div className="debate-number">#{searchHistory.length - index}</div>
                <div className="debate-item-main">
                  <div className="debate-header">
                    <h3 className="debate-topic">{item.topic}</h3>
                    <span className="debate-date">
                      {formatDateInKolkata(item.created_at, { day: 'numeric', month: 'short', year: 'numeric' })}
                    </span>
                  </div>
                  <div className="debate-stats">
                    <span className={`debate-badge ${item.transcription && item.transcription.length > 10 ? 'badge-with-args' : 'badge-no-args'}`}>
                      {item.transcription && item.transcription.length > 10 ? '✓ With Arguments' : '⚬ No Arguments'}
                    </span>
                    {item.transcription && item.transcription.length > 10 && item.score && (
                      <span className={`debate-score-badge ${(item.score || 0) >= 7.5 ? 'badge-win' : 'badge-no-win'}`}>
                        {(item.score || 0) >= 7.5 ? `🏆 Won (${item.score}/10)` : `📉 Loss (${item.score}/10)`}
                      </span>
                    )}
                    <span className="debate-time-badge">
                      🕐 {formatTimeInKolkata(item.created_at, { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>

      {/* ── Quick Argument Analyser ── */}
      <div className="dash-analyser-section">
        <div className="dash-analyser-header">
          <div className="dash-analyser-title-row">
            <span className="dash-analyser-icon">🔬</span>
            <div>
              <h2 className="dash-analyser-title">Quick Argument Analyser</h2>
              <p className="dash-analyser-sub">Paste or type any argument to get instant scores, tone detection &amp; structured feedback</p>
            </div>
          </div>
        </div>
        <div className="analyser-container">
          <div className="analyser-input-group">
            <div className="analyser-input-wrapper">
              <p className="selection-hint">Highlight any text (from a file or paste), then use <strong>Read aloud</strong> or <strong>Debate key points</strong>.</p>
              <textarea
                ref={analyserTextareaRef}
                value={analysisText}
                onChange={(e) => setAnalysisText(e.target.value)}
                onMouseUp={() => captureTextSelection(analyserTextareaRef.current)}
                onKeyUp={() => captureTextSelection(analyserTextareaRef.current)}
                placeholder="Paste your argument here or use the + button to add files..."
                className="analyser-textarea selectable-content"
              />
              {renderSelectionAssist()}
              <div className="analyser-actions">
                <div className="analyser-menu">
                  <button className="analyser-plus-btn" onClick={() => setShowAnalyserMenu(!showAnalyserMenu)}>
                    +
                  </button>
                  {showAnalyserMenu && (
                    <div className="analyser-menu-dropdown">
                      <button 
                        className="menu-item"
                        onClick={() => {
                          setAnalysisText('');
                          setAnalysisResult('');
                          setShowAnalyserMenu(false);
                        }}
                      >
                        <span>💬</span> New chat
                      </button>
                      <button 
                        className="menu-item"
                        onClick={() => {
                          document.getElementById('file-upload-analyser')?.click();
                          setShowAnalyserMenu(false);
                        }}
                      >
                        <span>📎</span> Add photos &amp; files
                      </button>
                      <button 
                        className="menu-item"
                        onClick={() => {
                          alert('Screenshot feature: Open screenshot tool on your system (Win+Shift+S) and paste here');
                          setShowAnalyserMenu(false);
                        }}
                      >
                        <span>📸</span> Take screenshot
                      </button>
                      <button 
                        className="menu-item"
                        onClick={() => {
                          if (recentAnalyserFiles.length > 0) {
                            setShowRecentFiles(!showRecentFiles);
                          } else {
                            alert('No recent files');
                          }
                        }}
                      >
                        <span>📁</span> Recent files ({recentAnalyserFiles.length})
                      </button>
                    </div>
                  )}
                  <input
                    id="file-upload-analyser"
                    type="file"
                    multiple
                    accept=".pdf,.doc,.docx,.txt,.md,.json,image/*,.json"
                    style={{ display: 'none' }}
                    onChange={(e) => handleAnalyserFileUpload(e)}
                  />
                </div>
                <button
                  onClick={handleAnalyseArgument}
                  disabled={!analysisText.trim() || isLoading}
                  className="analyser-btn"
                >
                  {isLoading ? '⏳ Analyzing...' : '✨ Analyze'}
                </button>
              </div>
            </div>
            
            {showRecentFiles && recentAnalyserFiles.length > 0 && (
              <div className="recent-files-list">
                <h4>Recent Files</h4>
                {recentAnalyserFiles.map((file, idx) => (
                  <div key={idx} className="recent-file-item" onClick={() => setAnalysisText(prev => prev + `\n[${file.name}]`)}>
                    📄 {file.name}
                  </div>
                ))}
              </div>
            )}
          </div>
          
          {analysisResult && (
            <div className="analyser-result">
              <div className="result-header">
                <h3>Analysis Results</h3>
                <button className="close-btn" onClick={() => setAnalysisResult('')}>✕</button>
              </div>
              <div className="result-content">
                {analysisResult}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  // Main Dashboard with Sidebar
  return (
    <div className={`app-container ${sidebarOpen ? '' : 'sidebar-closed'}`}>
      <div className="app-grid-bg"></div>
      <div className="app-flowing-lines"></div>

      {!sidebarOpen && (
        <button className="sidebar-toggle-floating" onClick={() => setSidebarOpen(true)} title="Show Sidebar">
          ☰
        </button>
      )}

      <aside className={`sidebar ${sidebarOpen ? 'open' : 'closed'}`}>
        <div className="sidebar-header">
          <div className="sidebar-logo">AI COACH</div>
          <button className="sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)}>
            ☰
          </button>
        </div>
        <nav className="sidebar-nav">
          <button className={`nav-item ${currentPage === 'dashboard' ? 'active' : ''}`} onClick={() => setCurrentPage('dashboard')}>
            <span className="nav-icon">📊</span>
            <span className="nav-text">Dashboard</span>
          </button>
          <button className={`nav-item ${currentPage === 'debate' ? 'active' : ''}`} onClick={() => setCurrentPage('debate')}>
            <span className="nav-icon">🎙️</span>
            <span className="nav-text">Start Debate</span>
          </button>
          <button className={`nav-item ${currentPage === 'history' ? 'active' : ''}`} onClick={() => { setCurrentPage('history'); loadSearchHistory(); }}>
            <span className="nav-icon">📜</span>
            <span className="nav-text">History</span>
          </button>
          <button className={`nav-item ${currentPage === 'analytics' ? 'active' : ''}`} onClick={() => { setCurrentPage('analytics'); loadSearchHistory(); }}>
            <span className="nav-icon">📈</span>
            <span className="nav-text">Analytics</span>
          </button>
          <button className={`nav-item ${currentPage === 'settings' ? 'active' : ''}`} onClick={() => setCurrentPage('settings')}>
            <span className="nav-icon">⚙️</span>
            <span className="nav-text">Settings</span>
          </button>
        </nav>
        <button className="logout-btn" onClick={handleLogout}>
          <span className="nav-icon">🚪</span>
          <span className="nav-text">Logout</span>
        </button>
      </aside>

      <main className="main-content">
        <div className="content-wrapper">
          {currentPage === 'dashboard' && renderDashboard()}
          
          {currentPage === 'debate' && (
          <div className="debate-section">
            <button 
              onClick={() => {
                setCurrentPage('dashboard');
                setTopic('');
                setDebateActive(false);
                setDebateSessionEnded(false);
                setDebateMode(null);
                setLatestAnalysis('');
                setDrawerOpen(false);
              }}
              className="back-button"
              style={{
                alignSelf: 'flex-start',
                marginBottom: '1rem',
                background: 'linear-gradient(135deg, rgba(100, 200, 255, 0.3), rgba(150, 100, 255, 0.3))',
                border: 'none',
                padding: '0.5rem 1rem',
                borderRadius: '8px',
                cursor: 'pointer',
                color: '#00d4ff',
                fontSize: '0.9rem'
              }}
            >
              ← Back to Dashboard
            </button>

            {/* ── MODE SELECTION SCREEN ── */}
            {!debateActive && !debateSessionEnded && !topic && !isPracticeMode && !isLiveMode && (
              <div className="mode-selection-container">
                <div className="mode-selection-header">
                  <h1>Choose Your Arena</h1>
                  <p>Select a mode to begin your debate journey</p>
                </div>

                <div className="mode-grid">
                  {/* PRACTICE MODE CARD */}
                  <div className="mode-card practice-card" onClick={() => { setDebateMode('practice'); }}>
                    <div className="mode-icon-box">🎓</div>
                    <h2 className="mode-card-title">Practice Mode</h2>
                    <p className="mode-card-desc">
                      Hone your skills. Debate against AI, work on rebuttals, or prepare your opening statement without time pressure.
                    </p>
                    <button className="mode-select-btn">Start Practicing</button>
                  </div>

                  {/* LIVE MODE CARD */}
                  <div className="mode-card live-card" onClick={() => { setDebateMode('live'); }}>
                    <div className="mode-icon-box">⚡</div>
                    <h2 className="mode-card-title">Live Mode</h2>
                    <p className="mode-card-desc">
                      Go real-time. Compete in live debates, engage in real-time battles, or practice against actual opponents.
                    </p>
                    <button className="mode-select-btn">Enter Live Debate</button>
                  </div>
                </div>
              </div>
            )}

            {/* ── DEBATE INTERFACE (Only show if mode selected) ── */}
            {(debateActive || debateSessionEnded || topic || isPracticeMode || isLiveMode) && (
            <div style={{position: 'relative', zIndex: 1}}>
            {/* ── Top bar: topic + round counter ── */}
            <div className="debate-top-bar">
              <div className="debate-topic-display">{topic || (activeMode === 'practice' ? 'Practice topic' : 'Enter a debate topic')}</div>
              <div className="debate-round-badge">{activeMode ? getModeLabel(activeMode) : 'Debate'}</div>
              {debateActive && !isPracticeMode && (
                <div className="debate-round-badge">Round {currentRound + (isRecording || isLoading ? 1 : 0)}</div>
              )}
            </div>

            {/* ── AI Avatar ── */}
            <div className="ai-avatar-section">
              <div className="ai-avatar">
                <div className="avatar-glow"></div>
                <div className="avatar-core"></div>
                <div className="hologram-flicker"></div>
              </div>
              <div className={`volume-equalizer ${equalizerActive ? 'active' : ''}`}>
                {[...Array(8)].map((_, i) => <div key={i} className="eq-bar"></div>)}
              </div>
            </div>

            {/* ── Practice Mode Input ── */}
            {isPracticeMode && !debateActive && !debateSessionEnded && (
              <div className="debate-input-section">
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Enter practice topic…"
                  className="debate-topic-input"
                />
                <button
                  onClick={() => { 
                    setDebateMode('practice');
                    setDebateActive(true); 
                    loadPracticeContent();
                  }}
                  disabled={loadingPracticeContent || !topic.trim()}
                  className="debate-start-btn"
                >
                  {loadingPracticeContent ? '⏳ Processing...' : '🎙️ Start Debate'}
                </button>
              </div>
            )}

            {/* ── Regular Debate Input ── */}
            {!isPracticeMode && !debateActive && !debateSessionEnded && (
              <div className="debate-input-section">
                <input
                  type="text"
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  placeholder="Enter debate topic…"
                  className="debate-topic-input"
                />
                <button
                  onClick={() => handleStartRecording(true)}
                  disabled={isLoading || !topic.trim()}
                  className="debate-start-btn"
                >
                  {isLoading ? '⏳ Processing...' : '🎙️ Start Debate'}
                </button>
              </div>
            )}

            {/* ── Practice Mode: Educational Content ── */}
            {isPracticeMode && debateActive && !debateSessionEnded && (
              <div className="practice-mode-content">
                {loadingPracticeContent ? (
                  <div className="practice-loading">
                    <div className="loading-spinner"></div>
                    <p>🤖 Generating personalized facts and truth about "{topic}"...</p>
                  </div>
                ) : (
                  <>
                    <p className="selection-hint practice-hint">
                      Highlight any sentence below, then tap <strong>Read aloud</strong> (human voice) or <strong>Debate key points</strong> to understand it better.
                    </p>
                    {renderSelectionAssist(topic)}

                    {keypointsContent && (
                      <div className="practice-mode-section keypoints-section">
                        <h3>🎯 Debate Key Points</h3>
                        <p className="section-subtitle">Essential ideas to understand this topic before you argue</p>
                        <div
                          className="practice-content-box selectable-content"
                          onMouseUp={() => captureTextSelection()}
                        >
                          {keypointsContent.split('\n').map((line, idx) => (
                            <p key={idx}>{line}</p>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="practice-mode-section">
                      <h3>📚 Facts (The Raw Materials)</h3>
                      <div
                        className="practice-content-box selectable-content"
                        onMouseUp={() => captureTextSelection()}
                      >
                        {factContent.split('\n').map((line, idx) => (
                          <p key={idx}>{line}</p>
                        ))}
                      </div>
                    </div>

                    <div className="practice-mode-section">
                      <h3>✨ Truth (The Constructed Reality)</h3>
                      <div
                        className="practice-content-box selectable-content"
                        onMouseUp={() => captureTextSelection()}
                      >
                        {truthContent.split('\n').map((line, idx) => (
                          <p key={idx}>{line}</p>
                        ))}
                      </div>
                    </div>

                    <div className="practice-mode-input">
                      <label>Enter Your Argument on "{topic}":</label>
                      <textarea
                        value={practiceArgument}
                        onChange={(e) => setPracticeArgument(e.target.value)}
                        placeholder="Type your argument here... Focus on facts and truth!"
                        className="practice-textarea"
                      />
                      <div className="practice-buttons">
                        <button 
                          className="practice-analyze-btn"
                          disabled={!practiceArgument.trim() || isLoading}
                          onClick={handlePracticeAnalyze}
                        >
                          {isLoading ? '⏳ Analyzing...' : '✨ Analyze My Argument'}
                        </button>
                        <button 
                          className="practice-exit-btn"
                          onClick={() => {
                            setDebateMode(null);
                            setDebateActive(false);
                            setDebateSessionEnded(false);
                            setTopic('');
                            setPracticeArgument('');
                            setKeypointsContent('');
                            setLatestAnalysis('');
                            clearTextSelection();
                            setCurrentPage('dashboard');
                          }}
                        >
                          ✕ Exit Practice Mode
                        </button>
                      </div>
                      {latestAnalysis && (
                        <div className="analyser-result practice-analysis-result">
                          <div className="result-header">
                            <h3>📊 Your Argument Analysis</h3>
                            <button className="close-btn" onClick={() => setLatestAnalysis('')}>✕</button>
                          </div>
                          <div className="result-content analysis-content">
                            {parseAnalysis(latestAnalysis)}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* ── Multi-round chat scroll area ── */}
            {!isPracticeMode && debateRounds.length > 0 && (
              <div className="debate-chat-scroll" ref={debateChatRef}>
                {debateRounds.map((round) => (
                  <div key={round.roundNum} className="debate-round-block">
                    <div className="round-label">Round {round.roundNum}</div>

                    {/* User bubble */}
                    <div className="transcript-bubble user-bubble">
                      <p className="bubble-label">🧑 Your Argument</p>
                      <p>{round.userArg}</p>
                    </div>

                    {/* AI bubble */}
                    <div className="transcript-bubble ai-bubble">
                      <p className="bubble-label">🤖 AI Response</p>
                      <p>{round.aiResponse}</p>
                      <div className="audio-controls">
                        <button onClick={() => speakText(round.aiResponse)} disabled={isSpeaking && !isPaused}>
                          {isSpeaking && !isPaused ? '🔊 Speaking...' : '🔊 Play'}
                        </button>
                        <button onClick={pauseSpeech} disabled={!isSpeaking || isPaused}>⏸️ Pause</button>
                        <button onClick={resumeSpeech} disabled={!isPaused}>▶️ Resume</button>
                        <button onClick={stopSpeech} disabled={!isSpeaking && !isPaused}>⏹️ Stop</button>
                      </div>
                    </div>

                    {/* Analysis (collapsed) */}
                    {round.analysis && (
                      <details className="round-analysis-details">
                        <summary>📊 View Round {round.roundNum} Analysis</summary>
                        <div className="analysis-content">{parseAnalysis(round.analysis)}</div>
                      </details>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* ── Recording status ── */}
            {isRecording && (
              <div className="recording-status">
                <span className="rec-dot" />
                <p>🎙️ Recording Round {currentRound + 1}… Speak your argument</p>
                {liveTranscription && (
                  <div className="live-transcription"><p>{liveTranscription}</p></div>
                )}
              </div>
            )}

            {/* ── Loading ── */}
            {isLoading && (
              <div className="recording-status">
                <span className="rec-dot processing" />
                <p>
                  {isPracticeMode
                    ? '⏳ Analyzing your argument…'
                    : `⏳ AI is thinking… processing Round ${currentRound + 1}`}
                </p>
              </div>
            )}

            {/* ── Continue / Stop controls (shown after each AI response, while session active) ── */}
            {debateActive && !isRecording && !isLoading && debateRounds.length > 0 && !debateSessionEnded && (
              <div className="debate-continue-bar">
                {!isRecording ? (
                  <button className="debate-continue-btn" onClick={() => handleStartRecording(false)}>
                    🎙️ Continue Debate (Round {currentRound + 1})
                  </button>
                ) : null}
                <button className="debate-stop-session-btn" onClick={handleStopDebateSession}>
                  🛑 Stop Debate
                </button>
              </div>
            )}

            {/* ── Active recording: only show Stop Recording button ── */}
            {debateActive && isRecording && (
              <div className="debate-continue-bar">
                <button className="debate-stop-btn" onClick={handleStopRecording}>
                  ⏹️ Stop Recording
                </button>
                <button className="debate-stop-session-btn" onClick={handleStopDebateSession}>
                  🛑 End Debate
                </button>
              </div>
            )}

            {/* ── Session ended summary ── */}
            {debateSessionEnded && debateRounds.length > 0 && (
              <div className="debate-summary-card">
                <div className="summary-icon">🏆</div>
                <h3>Debate Completed!</h3>
                <p className="summary-meta">
                  Topic: <strong>{topic}</strong> · {debateRounds.length} round{debateRounds.length > 1 ? 's' : ''} completed
                </p>
                <div className="summary-stats">
                  <div className="summary-stat">
                    <span className="summary-stat-val">{debateRounds.length}</span>
                    <span className="summary-stat-label">Rounds</span>
                  </div>
                  <div className="summary-stat">
                    <span className="summary-stat-val">
                      {debateRounds.filter(r => r.userArg && r.userArg.length > 20).length}
                    </span>
                    <span className="summary-stat-label">Full Arguments</span>
                  </div>
                  <div className="summary-stat">
                    <span className="summary-stat-val">
                      {debateRounds.reduce((sum, r) => sum + r.userArg.split(' ').length, 0)}
                    </span>
                    <span className="summary-stat-label">Total Words</span>
                  </div>
                </div>
                <div className="summary-actions">
                  <button className="debate-start-btn" onClick={() => {
                    setDebateSessionEnded(false);
                    setDebateActive(false);
                    setDebateRounds([]);
                    setCurrentRound(0);
                    setTopic('');
                  }}>
                    🎙️ Start New Debate
                  </button>
                  <button className="action-button secondary" onClick={() => { setCurrentPage('history'); loadSearchHistory(); }}>
                    📜 View History
                  </button>
                </div>
              </div>
            )}

            </div>
            )}

          </div>
          )}


          {currentPage === 'history' && (
            <div className="history-page">
              {selectedHistoryDebateId === null ? (
                <>
                  <div className="page-header">
                    <button 
                      onClick={() => setCurrentPage('dashboard')}
                      className="back-button"
                      style={{
                        background: 'linear-gradient(135deg, rgba(100, 200, 255, 0.3), rgba(150, 100, 255, 0.3))',
                        border: 'none',
                        padding: '0.5rem 1rem',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        color: '#00d4ff',
                        fontSize: '0.9rem',
                        marginRight: '1rem'
                      }}
                    >
                      ← Dashboard
                    </button>
                    <div style={{ flex: 1 }}>
                      <h2 style={{ margin: 0 }}>Debate History</h2>
                    </div>
                    <span className="history-count">{searchHistory.length} total debates</span>
                  </div>
                  <div className="history-list">
                    {searchHistory.length === 0 ? (
                      <div className="empty-state">
                        <p className="empty-icon">📜</p>
                        <p className="empty-title">No history yet</p>
                        <p className="empty-desc">Your debate sessions will appear here with full timestamps.</p>
                      </div>
                    ) : (
                      searchHistory.map((item: any, index: number) => {
                        const dateObj = new Date(item.created_at);
                        const hasArgs = item.transcription && item.transcription.length > 10;
                        const displayTopic = item.renamed_topic || item.topic;
                        return (
                          <div key={item.id} className="history-card" style={{position: 'relative'}}>
                            <div className="history-card-header">
                              <div className="history-card-left" onClick={() => setSelectedHistoryDebateId(item.id)} style={{cursor: 'pointer', flex: 1}}>
                                <span className="history-debate-num">#{searchHistory.length - index}</span>
                                <h3 className="history-topic">{displayTopic}</h3>
                                {item.pinned && <span style={{marginLeft: '0.5rem', color: '#ffd700'}}>📌</span>}
                                {item.archived && <span style={{marginLeft: '0.5rem', color: '#888'}}>📦</span>}
                              </div>
                              <div className="history-card-right" style={{display: 'flex', alignItems: 'center', gap: '1rem'}}>
                                <span className={`arg-badge ${hasArgs ? 'arg-badge--with' : 'arg-badge--without'}`}>
                                  {hasArgs ? '✓ With Arguments' : '⚬ No Arguments'}
                                </span>
                                <div style={{position: 'relative'}}>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setTopicMenuId(topicMenuId === item.id ? null : item.id);
                                    }}
                                    style={{
                                      background: 'none',
                                      border: 'none',
                                      fontSize: '1.5rem',
                                      cursor: 'pointer',
                                      padding: '0.5rem',
                                      color: '#00d4ff'
                                    }}
                                  >
                                    ⋮
                                  </button>
                                  {topicMenuId === item.id && (
                                    <div style={{
                                      position: 'absolute',
                                      right: 0,
                                      top: '100%',
                                      background: 'rgba(10, 20, 40, 0.95)',
                                      border: '1px solid rgba(0, 212, 255, 0.3)',
                                      borderRadius: '8px',
                                      minWidth: '150px',
                                      zIndex: 1000,
                                      boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)'
                                    }}>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setRenameTopicId(item.id);
                                          setNewTopicName(displayTopic);
                                          setShowRenameModal(true);
                                          setTopicMenuId(null);
                                        }}
                                        style={{
                                          display: 'block',
                                          width: '100%',
                                          padding: '0.75rem 1rem',
                                          border: 'none',
                                          background: 'none',
                                          color: '#00d4ff',
                                          cursor: 'pointer',
                                          textAlign: 'left',
                                          fontSize: '0.9rem',
                                          borderBottom: '1px solid rgba(0, 212, 255, 0.1)'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0, 212, 255, 0.1)'}
                                        onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                                      >
                                        ✏️ Rename
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleTopicAction(item.id, item.pinned ? 'unpin' : 'pin');
                                        }}
                                        style={{
                                          display: 'block',
                                          width: '100%',
                                          padding: '0.75rem 1rem',
                                          border: 'none',
                                          background: 'none',
                                          color: '#00d4ff',
                                          cursor: 'pointer',
                                          textAlign: 'left',
                                          fontSize: '0.9rem',
                                          borderBottom: '1px solid rgba(0, 212, 255, 0.1)'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0, 212, 255, 0.1)'}
                                        onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                                      >
                                        {item.pinned ? '📍 Unpin' : '📌 Pin'}
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleTopicAction(item.id, item.archived ? 'unarchive' : 'archive');
                                        }}
                                        style={{
                                          display: 'block',
                                          width: '100%',
                                          padding: '0.75rem 1rem',
                                          border: 'none',
                                          background: 'none',
                                          color: '#00d4ff',
                                          cursor: 'pointer',
                                          textAlign: 'left',
                                          fontSize: '0.9rem',
                                          borderBottom: '1px solid rgba(0, 212, 255, 0.1)'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(0, 212, 255, 0.1)'}
                                        onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                                      >
                                        {item.archived ? '📂 Unarchive' : '📦 Archive'}
                                      </button>
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeleteDebate(item.id);
                                        }}
                                        style={{
                                          display: 'block',
                                          width: '100%',
                                          padding: '0.75rem 1rem',
                                          border: 'none',
                                          background: 'none',
                                          color: '#ff4444',
                                          cursor: 'pointer',
                                          textAlign: 'left',
                                          fontSize: '0.9rem'
                                        }}
                                        onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255, 68, 68, 0.1)'}
                                        onMouseLeave={(e) => e.currentTarget.style.background = 'none'}
                                      >
                                        🗑️ Delete
                                      </button>
                                    </div>
                                  )}
                                </div>
                              </div>
                            </div>
                            <div className="history-datetime">
                              <span className="history-date-icon">📅</span>
                              <span className="history-date-text">
                                {formatDateInKolkata(dateObj, { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })}
                              </span>
                              <span className="history-time-sep">•</span>
                              <span className="history-time-icon">🕐</span>
                              <span className="history-time-text">
                                {formatTimeInKolkata(dateObj, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
                              </span>
                            </div>
                            {hasArgs && (
                              <div className="history-body" onClick={() => setSelectedHistoryDebateId(item.id)} style={{cursor: 'pointer'}}>
                                <div className="history-arg">
                                  <p className="history-arg-label">Your Argument</p>
                                  <p className="history-arg-text">{item.transcription.length > 200 ? item.transcription.substring(0, 200) + '...' : item.transcription}</p>
                                </div>
                                {item.rebuttal && (
                                  <div className="history-rebuttal">
                                    <p className="history-arg-label">AI Rebuttal</p>
                                    <p className="history-arg-text">{item.rebuttal.length > 200 ? item.rebuttal.substring(0, 200) + '...' : item.rebuttal}</p>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>

                  {showRenameModal && (
                    <div style={{
                      position: 'fixed',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      background: 'rgba(0, 0, 0, 0.7)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      zIndex: 2000
                    }}>
                      <div style={{
                        background: 'linear-gradient(135deg, rgba(30, 50, 80, 0.95), rgba(20, 40, 70, 0.95))',
                        border: '1px solid rgba(0, 212, 255, 0.3)',
                        borderRadius: '12px',
                        padding: '2rem',
                        minWidth: '400px',
                        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.5)'
                      }}>
                        <h3 style={{ color: '#00d4ff', marginTop: 0 }}>Rename Topic</h3>
                        <input
                          type="text"
                          value={newTopicName}
                          onChange={(e) => setNewTopicName(e.target.value)}
                          placeholder="Enter new topic name"
                          style={{
                            width: '100%',
                            padding: '0.75rem',
                            marginBottom: '1.5rem',
                            background: 'rgba(100, 200, 255, 0.1)',
                            border: '1px solid rgba(0, 212, 255, 0.3)',
                            borderRadius: '8px',
                            color: '#00d4ff',
                            fontSize: '1rem',
                            boxSizing: 'border-box'
                          }}
                        />
                        <div style={{display: 'flex', gap: '1rem', justifyContent: 'flex-end'}}>
                          <button
                            onClick={() => {
                              setShowRenameModal(false);
                              setNewTopicName('');
                              setRenameTopicId(null);
                            }}
                            style={{
                              padding: '0.75rem 1.5rem',
                              background: 'rgba(100, 100, 100, 0.3)',
                              border: '1px solid rgba(100, 100, 100, 0.5)',
                              borderRadius: '8px',
                              color: '#aaa',
                              cursor: 'pointer',
                              fontSize: '0.9rem'
                            }}
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => handleRenameDebate(renameTopicId!)}
                            style={{
                              padding: '0.75rem 1.5rem',
                              background: 'linear-gradient(135deg, rgba(0, 200, 255, 0.3), rgba(100, 150, 255, 0.3))',
                              border: '1px solid rgba(0, 212, 255, 0.5)',
                              borderRadius: '8px',
                              color: '#00d4ff',
                              cursor: 'pointer',
                              fontSize: '0.9rem'
                            }}
                          >
                            Rename
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div className="page-header" style={{display: 'flex', justifyContent: 'space-between', alignItems: 'center'}}>
                    <button 
                      onClick={() => setCurrentPage('dashboard')}
                      className="back-button"
                      style={{
                        background: 'linear-gradient(135deg, rgba(100, 200, 255, 0.3), rgba(150, 100, 255, 0.3))',
                        border: 'none',
                        padding: '0.5rem 1rem',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        color: '#00d4ff',
                        fontSize: '0.9rem',
                        marginBottom: '0'
                      }}
                    >
                      ← Dashboard
                    </button>
                    <h2>Debate Details</h2>
                    <div></div>
                  </div>
                  {(() => {
                    const debate = searchHistory.find((d: any) => d.id === selectedHistoryDebateId);
                    if (!debate) return <div className="empty-state"><p>Debate not found</p></div>;
                    const dateObj = new Date(debate.created_at);
                    const displayTopic = debate.renamed_topic || debate.topic;
                    return (
                      <div className="debate-detail-view">
                        <div className="detail-section">
                          <h3>📌 Topic</h3>
                          <p className="detail-content">{displayTopic}</p>
                        </div>
                        <div className="detail-section">
                          <h3>📅 Date & Time</h3>
                          <p className="detail-content">
                            {formatDateInKolkata(dateObj, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })} at {formatTimeInKolkata(dateObj, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
                          </p>
                        </div>
                        {debate.transcription && debate.transcription.trim().length > 0 && (
                          <div className="detail-section">
                            <h3>🗣️ Your Argument</h3>
                            <p className="detail-content">{debate.transcription}</p>
                          </div>
                        )}
                        {debate.rebuttal && debate.rebuttal.trim().length > 0 && (
                          <div className="detail-section">
                            <h3>🤖 AI Rebuttal</h3>
                            <p className="detail-content">{debate.rebuttal}</p>
                          </div>
                        )}
                        {debate.analysis && debate.analysis.trim().length > 0 && (
                          <div className="detail-section">
                            <h3>📊 Analysis</h3>
                            <div className="detail-content">{debate.analysis}</div>
                          </div>
                        )}
                        {debate.score && (
                          <div className="detail-section">
                            <h3>⭐ Score</h3>
                            <p className="detail-content detail-score">{debate.score}/10</p>
                          </div>
                        )}
                        <div className="detail-actions" style={{ marginTop: '1.5rem' }}>
                          <button
                            className="action-button primary"
                            onClick={() => {
                              setCurrentPage('debate');
                              continueDebateFromHistory(debate);
                            }}
                          >
                            Continue Debate
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          )}
          {currentPage === 'analytics' && (() => {
            // ── Live-computed analytics from searchHistory ──
            const withArgs = searchHistory.filter((d: any) => d.transcription && d.transcription.trim().length > 10).length;
            const total = searchHistory.length;
            const withArgsPct = total > 0 ? Math.round((withArgs / total) * 100) : 0;
            const avgLen = withArgs > 0
              ? Math.round(searchHistory.filter((d: any) => d.transcription && d.transcription.trim().length > 10)
                  .reduce((s: number, d: any) => s + d.transcription.length, 0) / withArgs)
              : 0;
            const avgScore = total > 0
              ? Math.round((searchHistory.reduce((s: number, d: any) => s + (d.score || 0), 0) / total) * 10) / 10
              : 0;
            const topicMap: Record<string, number> = {};
            searchHistory.forEach((d: any) => { if (d.topic) topicMap[d.topic] = (topicMap[d.topic] || 0) + 1; });
            const topTopic = Object.keys(topicMap).sort((a, b) => topicMap[b] - topicMap[a])[0] || '—';
            const engRate = total > 0 ? Math.round((withArgs / total) * 100) : 0;

            // ── Extract weak points from analysis texts ──
            const weakPoints: {topic: string; point: string}[] = [];
            searchHistory.slice(0, 8).forEach((d: any) => {
              if (!d.analysis) return;
              const analysisText: string = d.analysis;
              // grab sentences that contain weakness keywords
              const sentences = analysisText.split(/[.!\n]+/).map((s: string) => s.trim()).filter((s: string) => s.length > 20);
              const weakSentences = sentences.filter((s: string) =>
                /weak|improv|lack|miss|unclear|vague|avoid|fail|poor|limit|more evidence|not enough|unsupport/i.test(s)
              );
              weakSentences.slice(0, 2).forEach((pt: string) => {
                weakPoints.push({ topic: d.topic || 'Debate', point: pt });
              });
            });

            return (
              <div className="analytics-page">
                <button 
                  onClick={() => setCurrentPage('dashboard')}
                  className="back-button"
                  style={{
                    alignSelf: 'flex-start',
                    marginBottom: '1rem',
                    background: 'linear-gradient(135deg, rgba(100, 200, 255, 0.3), rgba(150, 100, 255, 0.3))',
                    border: 'none',
                    padding: '0.5rem 1rem',
                    borderRadius: '8px',
                    cursor: 'pointer',
                    color: '#00d4ff',
                    fontSize: '0.9rem'
                  }}
                >
                  ← Back to Dashboard
                </button>
                <div className="page-header">
                  <h2>Your Analytics</h2>
                  <span className="history-count">{total} debates analyzed</span>
                </div>

                {/* ── Top row: With Arguments + Feedback ── */}
                <div className="analytics-overview">

                  {/* Card 1: Debates WITH Arguments */}
                  <div className="analytics-card analytics-card--primary">
                    <div className="analytics-card-icon">&#x1F5E3;</div>
                    <div className="analytics-card-body">
                      <p className="analytics-card-label">Debates WITH Arguments</p>
                      <p className="analytics-card-value">{withArgs}</p>
                      <p className="analytics-card-desc">You actively argued your position</p>
                    </div>
                    <div className="analytics-progress-ring">
                      <svg viewBox="0 0 60 60" width="60" height="60">
                        <circle cx="30" cy="30" r="24" fill="none" stroke="rgba(127,90,240,0.15)" strokeWidth="6"/>
                        <circle
                          cx="30" cy="30" r="24" fill="none" stroke="#7F5AF0" strokeWidth="6"
                          strokeDasharray={`${(withArgsPct / 100) * 150.8} 150.8`}
                          strokeLinecap="round" transform="rotate(-90 30 30)"
                        />
                      </svg>
                      <span className="ring-pct">{withArgsPct}%</span>
                    </div>
                  </div>

                  {/* Card 2: Feedback – Key Weak Points */}
                  <div className="analytics-card analytics-card--feedback">
                    <div className="analytics-card-icon">&#x26A0;</div>
                    <div className="analytics-card-body" style={{flex:1}}>
                      <p className="analytics-card-label">Feedback &mdash; Key Weak Points</p>
                      {weakPoints.length === 0 ? (
                        <p className="analytics-card-desc" style={{marginTop:'0.5rem'}}>
                          {total === 0
                            ? 'Complete a debate to see your weak points.'
                            : 'No specific weak points detected yet — great work!'}
                        </p>
                      ) : (
                        <ul className="weak-points-list">
                          {weakPoints.slice(0, 5).map((wp, i) => (
                            <li key={i} className="weak-point-item">
                              <span className="weak-point-topic">{wp.topic}</span>
                              <span className="weak-point-text">{wp.point}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                </div>

                {/* ── Stats row ── */}
                <div className="analytics-stats-row">
                  <div className="analytics-stat-box">
                    <p className="analytics-stat-label">Avg Argument Length</p>
                    <p className="analytics-stat-val">{avgLen} <span>chars</span></p>
                  </div>
                  <div className="analytics-stat-box">
                    <p className="analytics-stat-label">Average Score</p>
                    <p className="analytics-stat-val">{avgScore} <span>/ 10</span></p>
                  </div>
                  <div className="analytics-stat-box">
                    <p className="analytics-stat-label">Most Debated Topic</p>
                    <p className="analytics-stat-val" style={{fontSize:'1rem'}}>{topTopic}</p>
                  </div>
                  <div className="analytics-stat-box">
                    <p className="analytics-stat-label">Engagement Rate</p>
                    <p className="analytics-stat-val">{engRate}<span>%</span></p>
                  </div>
                </div>

                {total === 0 && (
                  <div className="empty-state" style={{marginTop:'2rem'}}>
                    <p className="empty-icon">&#x1F4CA;</p>
                    <p className="empty-title">No data yet</p>
                    <p className="empty-desc">Complete at least one debate to see your analytics.</p>
                  </div>
                )}
              </div>
            );
          })()}

          {currentPage === 'settings' && (
            <div className="settings-page">
              <button 
                onClick={() => setCurrentPage('dashboard')}
                className="back-button"
                style={{
                  alignSelf: 'flex-start',
                  marginBottom: '1rem',
                  background: 'linear-gradient(135deg, rgba(100, 200, 255, 0.3), rgba(150, 100, 255, 0.3))',
                  border: 'none',
                  padding: '0.5rem 1rem',
                  borderRadius: '8px',
                  cursor: 'pointer',
                  color: '#00d4ff',
                  fontSize: '0.9rem'
                }}
              >
                ← Back to Dashboard
              </button>
              <div className="page-header">
                <h2>Settings</h2>
              </div>

              <div className="settings-section">
                <h3 className="settings-section-title">👤 Profile Information</h3>
                <div className="profile-card">
                  <div className="profile-avatar-wrapper">
                    <div className="profile-avatar-circle">
                      {(currentUser?.username || 'U')[0].toUpperCase()}
                    </div>
                    <div className="profile-avatar-glow"></div>
                  </div>
                  <div className="profile-info">
                    {isEditingProfile ? (
                      <div className="profile-edit-form">
                        <div className="profile-field">
                          <label>Username</label>
                          <input
                            type="text"
                            value={profileData.username}
                            onChange={e => setProfileData({...profileData, username: e.target.value})}
                            className="profile-input"
                          />
                        </div>
                        <div className="profile-field">
                          <label>Email</label>
                          <input
                            type="email"
                            value={profileData.email}
                            onChange={e => setProfileData({...profileData, email: e.target.value})}
                            className="profile-input"
                            readOnly
                          />
                        </div>
                        <div className="profile-edit-actions">
                          <button
                            className="profile-save-btn"
                            onClick={() => setIsEditingProfile(false)}
                          >
                            ✓ Save Changes
                          </button>
                          <button
                            className="profile-cancel-btn"
                            onClick={() => {
                              setProfileData({ username: currentUser?.username || '', email: currentUser?.email || '', avatar: '' });
                              setIsEditingProfile(false);
                            }}
                          >
                            ✕ Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="profile-view">
                        <div className="profile-detail-row">
                          <span className="profile-detail-label">Username</span>
                          <span className="profile-detail-value">{profileData.username || currentUser?.username}</span>
                        </div>
                        <div className="profile-detail-row">
                          <span className="profile-detail-label">Email</span>
                          <span className="profile-detail-value">{profileData.email || currentUser?.email}</span>
                        </div>
                        <div className="profile-detail-row">
                          <span className="profile-detail-label">Member Since</span>
                          <span className="profile-detail-value">
                            {currentUser?.created_at ? formatDateInKolkata(currentUser.created_at, { day: 'numeric', month: 'long', year: 'numeric' }) : '—'}
                          </span>
                        </div>
                        <div className="profile-detail-row">
                          <span className="profile-detail-label">Total Debates</span>
                          <span className="profile-detail-value highlight">{computedStats.totalDebates}</span>
                        </div>
                        <button
                          className="profile-edit-btn"
                          onClick={() => {
                            setProfileData({
                              username: currentUser?.username || '',
                              email: currentUser?.email || '',
                              avatar: '',
                            });
                            setIsEditingProfile(true);
                          }}
                        >
                          ✏️ Edit Profile
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="settings-section">
                <h3 className="settings-section-title">🔊 Voice & Tone Settings</h3>
                <div className="voice-settings-card">
                  <p className="settings-help-text">
                    Choose the voice and tone of your AI Debate Coach. Select from pre-configured voice tones, or customize settings manually.
                  </p>
                  
                  <div className="voice-presets-grid">
                    {VOICE_PRESETS.map((preset) => (
                      <div 
                        key={preset.id}
                        className={`voice-preset-option ${selectedVoicePreset === preset.id && !customVoiceName ? 'active' : ''}`}
                        onClick={() => {
                          setSelectedVoicePreset(preset.id);
                          setCustomVoiceName('');
                          setVoicePitch(preset.pitch);
                          setVoiceRate(preset.rate);
                          localStorage.setItem('selectedVoicePreset', preset.id);
                          localStorage.removeItem('customVoiceName');
                          localStorage.setItem('voicePitch', preset.pitch.toString());
                          localStorage.setItem('voiceRate', preset.rate.toString());
                        }}
                      >
                        <div className="preset-name">{preset.name}</div>
                        <div className="preset-desc">{preset.description}</div>
                        <div className="preset-badge">{preset.gender === 'male' ? 'Male Voice' : 'Female Voice'}</div>
                      </div>
                    ))}
                  </div>

                  <div className="voice-advanced-toggle">
                    <button 
                      type="button" 
                      onClick={() => setShowAdvancedVoice(!showAdvancedVoice)}
                      className="advanced-toggle-btn"
                    >
                      {showAdvancedVoice ? '▼ Hide Advanced Controls' : '▶ Show Advanced Controls'}
                    </button>
                  </div>

                  {showAdvancedVoice && (
                    <div className="voice-advanced-controls">
                      <div className="control-group">
                        <label className="control-label">Select Specific System Voice</label>
                        <select 
                          value={customVoiceName}
                          onChange={(e) => {
                            const val = e.target.value;
                            setCustomVoiceName(val);
                            localStorage.setItem('customVoiceName', val);
                          }}
                          className="voice-select-dropdown"
                        >
                          <option value="">-- Use Preset Default --</option>
                          {availableVoices
                            .filter(v => v.lang.startsWith('en'))
                            .map((v) => (
                              <option key={v.name} value={v.name}>
                                {v.name} ({v.lang})
                              </option>
                            ))}
                        </select>
                      </div>

                      <div className="sliders-grid">
                        <div className="control-group">
                          <label className="control-label">Pitch: {voicePitch.toFixed(2)}</label>
                          <input 
                            type="range" 
                            min="0.5" 
                            max="2.0" 
                            step="0.05"
                            value={voicePitch}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setVoicePitch(val);
                              localStorage.setItem('voicePitch', val.toString());
                            }}
                            className="voice-range-slider"
                          />
                        </div>

                        <div className="control-group">
                          <label className="control-label">Speed (Rate): {voiceRate.toFixed(2)}</label>
                          <input 
                            type="range" 
                            min="0.5" 
                            max="2.0" 
                            step="0.05"
                            value={voiceRate}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setVoiceRate(val);
                              localStorage.setItem('voiceRate', val.toString());
                            }}
                            className="voice-range-slider"
                          />
                        </div>

                        <div className="control-group">
                          <label className="control-label">Volume: {Math.round(volume * 100)}%</label>
                          <input 
                            type="range" 
                            min="0" 
                            max="1" 
                            step="0.05"
                            value={volume}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value);
                              setVolume(val);
                              localStorage.setItem('voiceVolume', val.toString());
                            }}
                            className="voice-range-slider"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="voice-preview-box">
                    <button 
                      type="button" 
                      onClick={() => speakText("Hello, this is a voice test for the AI Debate Coach. How do I sound?")}
                      className="voice-test-btn"
                    >
                      🔊 Test Voice Tone
                    </button>
                  </div>
                </div>
              </div>

              <div className="settings-section">
                <h3 className="settings-section-title">🏆 Performance Summary</h3>
                <div className="settings-stats-grid">
                  <div className="settings-stat">
                    <p className="settings-stat-label">Total Debates</p>
                    <p className="settings-stat-val">{computedStats.totalDebates}</p>
                  </div>
                  <div className="settings-stat">
                    <p className="settings-stat-label">Win Rate</p>
                    <p className="settings-stat-val">{computedStats.winRate}%</p>
                  </div>
                  <div className="settings-stat">
                    <p className="settings-stat-label">Avg Score</p>
                    <p className="settings-stat-val">{computedStats.averageScore}/10</p>
                  </div>
                  <div className="settings-stat">
                    <p className="settings-stat-label">With Arguments</p>
                    <p className="settings-stat-val">{0}</p>
                  </div>
                </div>
              </div>

              <div className="settings-section">
                <h3 className="settings-section-title">🚪 Account</h3>
                <button className="settings-logout-btn" onClick={handleLogout}>
                  Sign Out
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

declare global {
  interface Window {
    webkitSpeechRecognition: any;
  }
}

export default App;
