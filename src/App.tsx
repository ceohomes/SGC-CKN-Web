import React, { useState, useRef, useEffect } from 'react';
import { 
  Upload, 
  FileText, 
  BarChart3, 
  Table as TableIcon, 
  Loader2, 
  CheckCircle2, 
  AlertCircle,
  Construction,
  ChevronRight,
  ChevronLeft,
  ArrowDownToLine,
  Activity,
  Calendar,
  Layers,
  Menu,
  Database,
  History,
  X,
  Settings,
  Save,
  Key,
  RotateCcw,
  ImageIcon,
  Trash2,
  ExternalLink,
  Cloud,
  Github,
  Edit2,
  Maximize2,
  Minimize2,
  ZoomIn as ZoomInIcon,
  ZoomOut as ZoomOutIcon
} from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { supabase } from './supabase';
import { Document, Page, pdfjs } from 'react-pdf';
import 'react-pdf/dist/Page/TextLayer.css';
import 'react-pdf/dist/Page/AnnotationLayer.css';

// Configure PDF.js worker
pdfjs.GlobalWorkerOptions.workerSrc = `//unpkg.com/pdfjs-dist@${pdfjs.version}/build/pdf.worker.min.mjs`;

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// --- Types ---

interface DrillLayer {
  project: string;
  item: string;
  componentName: string;
  pileId: string;
  diameter: string;
  constructionStart: string;
  constructionEnd: string;
  layerNumber: number;
  layerDesign: string;
  timeFrom: string;
  timeTo: string;
  elevationFrom: number;
  elevationTo: number;
  geologyType: string;
  durationHours: number;
  lengthMeters: number;
  speedMph: number;
}

interface ExtractionResult {
  id: string;
  timestamp: number;
  project: string;
  item: string;
  componentName: string;
  pileId: string;
  diameter: string;
  constructionStart: string;
  constructionEnd: string;
  layers: DrillLayer[];
  summary: string;
  fileName?: string;
  fileUrl?: string;
}

interface ProcessingFile {
  id: string;
  fileName: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
  result?: ExtractionResult;
  error?: string;
}

type AppSheet = 'upload' | 'summary';

// --- Helper Functions ---

const parseTimeToMinutes = (timeStr: string): number => {
  if (!timeStr) return 0;
  let cleanTime = timeStr.toLowerCase()
    .replace('h', ':')
    .split(' ')[0]
    .trim();
    
  const parts = cleanTime.split(':');
  if (parts.length < 2) return 0;
  
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  
  if (isNaN(hours) || isNaN(minutes)) return 0;
  return hours * 60 + minutes;
};

// --- Gemini Service ---

const extractDataFromFile = async (base64Data: string, mimeType: string, userApiKey?: string): Promise<Omit<ExtractionResult, 'id' | 'timestamp'>> => {
  const apiKey = userApiKey || process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("API Key không tồn tại. Vui lòng cấu hình trong phần Cài đặt.");
  
  const ai = new GoogleGenAI({ apiKey });
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          {
            text: `Bạn là một chuyên gia OCR xây dựng. Hãy trích xuất dữ liệu từ "Biên bản theo dõi địa chất".
            
            Yêu cầu trích xuất:
            1. Dự án (project)
            2. Hạng mục (item)
            3. Tên bộ phận (componentName)
            4. Số hiệu cọc (pileId)
            5. Đường kính (diameter)
            6. Thời gian bắt đầu thi công (constructionStart)
            7. Thời gian kết thúc thi công (constructionEnd)
            8. Danh sách các lớp địa chất (layers): 
               - layerNumber: Số thứ tự lớp.
               - layerDesign: Nội dung mô tả thiết kế địa chất.
               - timeFrom: Giờ bắt đầu khoan (định dạng HH:mm).
               - timeTo: Giờ kết thúc khoan (định dạng HH:mm).
               - elevationFrom: Cao độ bắt đầu.
               - elevationTo: Cao độ kết thúc.
               - geologyType: Địa chất thực tế.
            
            Lưu ý: Chỉ trích xuất số liệu thô. Trả về JSON.`
          },
          {
            inlineData: {
              mimeType: mimeType,
              data: base64Data.includes(',') ? base64Data.split(',')[1] : base64Data
            }
          }
        ]
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          project: { type: Type.STRING },
          item: { type: Type.STRING },
          componentName: { type: Type.STRING },
          pileId: { type: Type.STRING },
          diameter: { type: Type.STRING },
          constructionStart: { type: Type.STRING },
          constructionEnd: { type: Type.STRING },
          layers: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                layerNumber: { type: Type.INTEGER },
                layerDesign: { type: Type.STRING },
                timeFrom: { type: Type.STRING },
                timeTo: { type: Type.STRING },
                elevationFrom: { type: Type.NUMBER },
                elevationTo: { type: Type.NUMBER },
                geologyType: { type: Type.STRING }
              },
              required: ["layerNumber", "layerDesign", "timeFrom", "timeTo", "elevationFrom", "elevationTo", "geologyType"]
            }
          },
          summary: { type: Type.STRING }
        },
        required: ["project", "item", "componentName", "pileId", "diameter", "constructionStart", "constructionEnd", "layers"]
      }
    }
  });

  const text = response.text;
  if (!text) throw new Error("Không có phản hồi từ AI");
  const rawData = JSON.parse(text);

  const processedLayers = rawData.layers.map((layer: any) => {
    const startMinutes = parseTimeToMinutes(layer.timeFrom);
    const endMinutes = parseTimeToMinutes(layer.timeTo);
    let durationMinutes = endMinutes - startMinutes;
    if (durationMinutes < 0) durationMinutes += 24 * 60;
    if (durationMinutes <= 0) durationMinutes = 30; 
    const durationHours = durationMinutes / 60;
    const length = Math.abs(layer.elevationTo - layer.elevationFrom);
    const speed = durationHours > 0 ? length / durationHours : 0;

    return {
      ...layer,
      project: rawData.project,
      item: rawData.item,
      componentName: rawData.componentName,
      pileId: rawData.pileId,
      diameter: rawData.diameter,
      constructionStart: rawData.constructionStart,
      constructionEnd: rawData.constructionEnd,
      durationHours: durationHours,
      lengthMeters: length,
      speedMph: speed
    };
  });

  return { ...rawData, layers: processedLayers };
};

// --- Components ---

export default function App() {
  const [activeSheet, setActiveSheet] = useState<AppSheet>('upload');
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [currentResult, setCurrentResult] = useState<ExtractionResult | null>(null);
  const [history, setHistory] = useState<ExtractionResult[]>([]);
  const [processingFiles, setProcessingFiles] = useState<ProcessingFile[]>([]);
  const [pendingResults, setPendingResults] = useState<ExtractionResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [userApiKey, setUserApiKey] = useState<string>('');
  const [customLogo, setCustomLogo] = useState<string | null>(null);
  const [isGithubConnected, setIsGithubConnected] = useState<boolean>(false);
  const [isConnectingGithub, setIsConnectingGithub] = useState<boolean>(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingResult, setEditingResult] = useState<ExtractionResult | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const logoInputRef = useRef<HTMLInputElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Load history, API key, and logo from localStorage and Supabase on mount
  useEffect(() => {
    const loadData = async () => {
      // Load from localStorage first for offline feel
      const savedHistory = localStorage.getItem('pile_drill_history');
      if (savedHistory) {
        try {
          setHistory(JSON.parse(savedHistory));
        } catch (e) {
          console.error("Failed to load history", e);
        }
      }

      const savedApiKey = localStorage.getItem('gemini_api_key');
      if (savedApiKey) {
        setUserApiKey(savedApiKey);
      }

      const savedLogo = localStorage.getItem('pile_drill_custom_logo');
      if (savedLogo) {
        setCustomLogo(savedLogo);
      }

      // Sync with Supabase if available
      if (supabase) {
        try {
          // 1. Sync History
          const { data: historyData, error: historyError } = await supabase
            .from('drill_extractions')
            .select('*')
            .order('timestamp', { ascending: false });
          
          if (!historyError && historyData) {
            setHistory(historyData);
            localStorage.setItem('pile_drill_history', JSON.stringify(historyData));
          }

          // 2. Sync Settings (API Key & Logo)
          const { data: settingsData, error: settingsError } = await supabase
            .from('app_settings')
            .select('*');

          if (!settingsError && settingsData) {
            const apiKeySetting = settingsData.find(s => s.id === 'gemini_api_key');
            const logoSetting = settingsData.find(s => s.id === 'app_logo');

            if (apiKeySetting && apiKeySetting.value) {
              setUserApiKey(apiKeySetting.value);
              localStorage.setItem('gemini_api_key', apiKeySetting.value);
            }
            if (logoSetting && logoSetting.value) {
              setCustomLogo(logoSetting.value);
              localStorage.setItem('pile_drill_custom_logo', logoSetting.value);
            }
          }
        } catch (e) {
          console.error("Supabase sync failed", e);
        }
      }
    };

    loadData();

    const checkGithubStatus = async () => {
      // First check if environment variables are available directly (for static deployments)
      if (process.env.GITHUB_TOKEN && process.env.GITHUB_USERNAME) {
        setIsGithubConnected(true);
        return;
      }

      try {
        const res = await fetch('/api/auth/github/status');
        if (res.ok) {
          const data = await res.json();
          setIsGithubConnected(data.connected);
        }
      } catch (e) {
        console.error("Failed to check GitHub status", e);
      }
    };
    checkGithubStatus();

    // Periodic check every 30 seconds
    const statusInterval = setInterval(checkGithubStatus, 30000);

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'GITHUB_AUTH_SUCCESS') {
        setIsGithubConnected(true);
        setIsConnectingGithub(false);
      }
    };
    window.addEventListener('message', handleMessage);

    // 3. Realtime Subscription for Settings
    let settingsSubscription: any = null;
    if (supabase) {
      settingsSubscription = supabase
        .channel('public:app_settings')
        .on('postgres_changes', { event: '*', table: 'app_settings', schema: 'public' }, (payload) => {
          const { id, value } = payload.new as any;
          if (id === 'gemini_api_key') {
            setUserApiKey(value);
            localStorage.setItem('gemini_api_key', value);
          } else if (id === 'app_logo') {
            setCustomLogo(value || null);
            if (value) {
              localStorage.setItem('pile_drill_custom_logo', value);
            } else {
              localStorage.removeItem('pile_drill_custom_logo');
            }
          }
        })
        .subscribe();
    }

    return () => {
      window.removeEventListener('message', handleMessage);
      clearInterval(statusInterval);
      if (settingsSubscription) {
        supabase?.removeChannel(settingsSubscription);
      }
    };
  }, []);

  // Save history to localStorage whenever it changes
  useEffect(() => {
    localStorage.setItem('pile_drill_history', JSON.stringify(history));
  }, [history]);

  const saveApiKey = async (key: string) => {
    setUserApiKey(key);
    localStorage.setItem('gemini_api_key', key);
    
    // Save to Supabase
    if (supabase) {
      try {
        await supabase
          .from('app_settings')
          .upsert({ id: 'gemini_api_key', value: key, updated_at: new Date().toISOString() });
      } catch (e) {
        console.error("Failed to save API key to Supabase", e);
      }
    }
    
    setIsSettingsOpen(false);
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (event) => {
      const base64 = event.target?.result as string;
      setCustomLogo(base64);
      localStorage.setItem('pile_drill_custom_logo', base64);
      
      // Save to Supabase
      if (supabase) {
        try {
          await supabase
            .from('app_settings')
            .upsert({ id: 'app_logo', value: base64, updated_at: new Date().toISOString() });
        } catch (e) {
          console.error("Failed to save logo to Supabase", e);
        }
      }
    };
    reader.readAsDataURL(file);
  };

  const resetLogo = async () => {
    setCustomLogo(null);
    localStorage.removeItem('pile_drill_custom_logo');
    
    // Clear in Supabase
    if (supabase) {
      try {
        await supabase
          .from('app_settings')
          .upsert({ id: 'app_logo', value: '', updated_at: new Date().toISOString() });
      } catch (e) {
        console.error("Failed to reset logo in Supabase", e);
      }
    }
  };

  const connectGithub = async () => {
    alert(`HƯỚNG DẪN KẾT NỐI GITHUB:
1. Truy cập GitHub Settings > Developer Settings > Personal Access Tokens.
2. Tạo Token mới (Classic hoặc Fine-grained) với quyền 'repo'.
3. Mở bảng 'Secrets' trong AI Studio Build.
4. Thêm các biến sau:
   - GITHUB_TOKEN: (Token của bạn)
   - GITHUB_USERNAME: (Tên người dùng GitHub)
   - GITHUB_REPO: (Tên repository, mặc định: construction-reports)
5. Khởi động lại Server nếu cần.`);
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newFiles: ProcessingFile[] = Array.from(files).map(file => ({
      id: crypto.randomUUID(),
      fileName: file.name,
      status: 'pending',
      progress: 0
    }));

    setProcessingFiles(prev => [...newFiles, ...prev]);
    setIsProcessing(true);
    setError(null);

    const processFile = async (pFile: ProcessingFile, file: File) => {
      setProcessingFiles(prev => prev.map(f => f.id === pFile.id ? { ...f, status: 'processing', progress: 10 } : f));

      try {
        const getBase64 = (file: File): Promise<string> => {
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
          });
        };

        const compressImage = (file: File): Promise<string> => {
          return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(file);
            reader.onload = (event) => {
              const img = new Image();
              img.src = event.target?.result as string;
              img.onload = () => {
                const canvas = document.createElement('canvas');
                const MAX_WIDTH = 2000;
                const MAX_HEIGHT = 2000;
                let width = img.width;
                let height = img.height;
                if (width > height) {
                  if (width > MAX_WIDTH) { height *= MAX_WIDTH / width; width = MAX_WIDTH; }
                } else {
                  if (height > MAX_HEIGHT) { width *= MAX_HEIGHT / height; height = MAX_HEIGHT; }
                }
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx?.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', 0.8));
              };
              img.onerror = reject;
            };
            reader.onerror = reject;
          });
        };

        let base64 = "";
        let mimeType = file.type;

        if (file.type === "application/pdf") {
          base64 = await getBase64(file);
        } else if (file.type.startsWith("image/")) {
          base64 = await compressImage(file);
          mimeType = "image/jpeg"; // Standardize to jpeg after compression
        } else {
          throw new Error("Định dạng tệp không được hỗ trợ. Vui lòng sử dụng ảnh hoặc PDF.");
        }

        setProcessingFiles(prev => prev.map(f => f.id === pFile.id ? { ...f, progress: 40 } : f));

        const rawResult = await extractDataFromFile(base64, mimeType, userApiKey);
        setProcessingFiles(prev => prev.map(f => f.id === pFile.id ? { ...f, progress: 80 } : f));

        const result: ExtractionResult = {
          ...rawResult,
          id: Math.random().toString(36).substring(7),
          timestamp: Date.now(),
          fileName: file.name
        };

        // Upload to GitHub if connected
        if (isGithubConnected) {
          try {
            console.log("Attempting GitHub upload for:", file.name);
            setProcessingFiles(prev => prev.map(f => f.id === pFile.id ? { ...f, progress: 90 } : f));
            
            let uploadData: any = null;
            
            // Try backend first
            try {
              const uploadRes = await fetch('/api/github/upload', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fileName: file.name, base64Data: base64 })
              });
              if (uploadRes.ok) {
                uploadData = await uploadRes.json();
              }
            } catch (backendError) {
              console.log("Backend upload failed, trying client-side fallback...");
            }

            // Client-side fallback if backend failed but we have env vars
            if (!uploadData && process.env.GITHUB_TOKEN && process.env.GITHUB_USERNAME) {
              const token = process.env.GITHUB_TOKEN;
              const username = process.env.GITHUB_USERNAME;
              const repo = process.env.GITHUB_REPO || "construction-reports";
              
              // Add timestamp to filename to avoid "File already exists" error
              const timestamp = new Date().getTime();
              const safeFileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
              const path = `SGC-CKN/${timestamp}_${safeFileName}`;
              const content = base64.split(',')[1];

              console.log(`Client-side upload to: ${username}/${repo}/contents/${path}`);

              const ghRes = await fetch(`https://api.github.com/repos/${username}/${repo}/contents/${path}`, {
                method: 'PUT',
                headers: {
                  'Authorization': `Bearer ${token.trim()}`,
                  'Accept': 'application/vnd.github.v3+json',
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  message: `Upload ${file.name} via SGC-CKN Web`,
                  content: content,
                })
              });

              if (ghRes.ok) {
                const ghData = await ghRes.json();
                uploadData = { fileUrl: ghData.content.download_url };
                console.log("GitHub upload success:", uploadData.fileUrl);
              } else {
                const errorData = await ghRes.json();
                console.error("GitHub API Error:", errorData);
                alert(`Lỗi GitHub: ${errorData.message || 'Không thể upload file'}. Vui lòng kiểm tra quyền của Token hoặc tên Repo.`);
              }
            }

            if (uploadData && uploadData.fileUrl) {
              result.fileUrl = uploadData.fileUrl;
              console.log("File URL assigned to result:", result.fileUrl);
            } else {
              console.warn("GitHub upload failed or no fileUrl returned");
            }
          } catch (e) {
            console.error("GitHub upload failed", e);
          }
        } else {
          console.log("GitHub not connected, skipping upload.");
        }

        setPendingResults(prev => [result, ...prev]);
        setProcessingFiles(prev => prev.map(f => f.id === pFile.id ? { ...f, status: 'completed', progress: 100, result } : f));
        
        if (files.length === 1) {
          setCurrentResult(result);
        }

      } catch (err: any) {
        console.error(err);
        const errorMessage = err.message || "Đã xảy ra lỗi không xác định";
        setProcessingFiles(prev => prev.map(f => f.id === pFile.id ? { ...f, status: 'error', error: errorMessage } : f));
      }
    };

    for (let i = 0; i < Array.from(files).length; i++) {
      await processFile(newFiles[i], Array.from(files)[i]);
    }

    setIsProcessing(false);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeProcessingFile = (id: string) => {
    setProcessingFiles(prev => prev.filter(f => f.id !== id));
  };

  const saveResult = async (result: ExtractionResult) => {
    console.log("Saving result to Supabase:", result);
    
    if (isGithubConnected && !result.fileUrl) {
      const proceed = window.confirm("Cảnh báo: GitHub đã kết nối nhưng không tìm thấy link file. Bạn có muốn tiếp tục lưu mà không có file không?");
      if (!proceed) return;
    }

    // Save to Supabase
    if (supabase) {
      try {
        // Prepare data for Supabase (remove client-side temporary ID to let DB generate UUID)
        const { id, ...dataToSave } = result;
        console.log("Data being sent to Supabase:", dataToSave);
        const { error: supabaseError } = await supabase.from('drill_extractions').insert([dataToSave]);
        
        if (supabaseError) {
          console.error("Supabase error:", supabaseError);
          alert("Lỗi khi lưu vào Supabase: " + supabaseError.message);
          return;
        }
      } catch (e) {
        console.error("Failed to save to Supabase", e);
        alert("Lỗi kết nối Supabase: " + (e as any).message);
        return;
      }
    } else {
      console.warn("Supabase client not initialized.");
      alert("Lỗi: Không thể kết nối với Supabase. Vui lòng kiểm tra lại mã nguồn.");
    }

    setHistory(prev => [result, ...prev]);
    setPendingResults(prev => prev.filter(r => r.id !== result.id));
    
    // If it was the current result being viewed, we keep it there but it's now in history
    if (currentResult?.id === result.id) {
      setCurrentResult(result);
    }
  };

  const cancelResult = (id: string) => {
    setPendingResults(prev => prev.filter(r => r.id !== id));
    if (currentResult?.id === id) {
      setCurrentResult(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Bạn có chắc chắn muốn xóa dữ liệu này?")) return;

    if (supabase) {
      try {
        const { error } = await supabase.from('drill_extractions').delete().eq('id', id);
        if (error) throw error;
      } catch (e) {
        console.error("Failed to delete from Supabase", e);
        alert("Lỗi khi xóa dữ liệu");
        return;
      }
    }

    setHistory(prev => prev.filter(item => item.id !== id));
    if (currentResult?.id === id) setCurrentResult(null);
  };

  const handleEdit = (result: ExtractionResult) => {
    setEditingResult(JSON.parse(JSON.stringify(result)));
    setIsEditModalOpen(true);
  };

  const handleSaveEdit = async (updatedResult: ExtractionResult) => {
    if (supabase) {
      try {
        const { error } = await supabase
          .from('drill_extractions')
          .update(updatedResult)
          .eq('id', updatedResult.id);
        if (error) throw error;
      } catch (e) {
        console.error("Failed to update Supabase", e);
        alert("Lỗi khi cập nhật dữ liệu");
        return;
      }
    }

    setHistory(prev => prev.map(item => item.id === updatedResult.id ? updatedResult : item));
    setIsEditModalOpen(false);
    setEditingResult(null);
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 font-sans overflow-x-hidden">
      {/* Sidebar Overlay */}
      <div 
        className={cn(
          "fixed inset-0 bg-slate-900/40 backdrop-blur-sm z-40 transition-opacity duration-300",
          isSidebarOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setIsSidebarOpen(false)}
      />

      {/* Sidebar Menu */}
      <aside 
        ref={sidebarRef}
        className={cn(
          "fixed top-0 left-0 h-full w-72 bg-sky-50 z-50 shadow-2xl transition-transform duration-500 ease-out transform border-r border-sky-200",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
        onMouseLeave={() => setIsSidebarOpen(false)}
      >
        <div className="p-8 h-full flex flex-col">
          <div className="flex items-center justify-between mb-10">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center shadow-sm border border-sky-200">
                {customLogo ? (
                  <img src={customLogo} alt="Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <div className="bg-blue-600 w-full h-full flex items-center justify-center">
                    <Construction className="text-white w-5 h-5" />
                  </div>
                )}
              </div>
              <div>
                <span className="font-bold text-blue-900 uppercase tracking-tight block text-lg">SGC - CKN</span>
                <span className="text-[8px] font-bold text-sky-400 uppercase tracking-[0.2em]">Management System</span>
              </div>
            </div>
            <button onClick={() => setIsSidebarOpen(false)} className="p-2 hover:bg-sky-100 rounded-lg transition-colors text-sky-400">
              <X className="w-4 h-4" />
            </button>
          </div>

          <nav className="space-y-1 flex-1">
            <p className="text-[10px] font-bold text-sky-400 uppercase tracking-widest mb-4 px-4">Main Navigation</p>
            <button 
              onClick={() => { setActiveSheet('upload'); setIsSidebarOpen(false); }}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all group",
                activeSheet === 'upload' 
                  ? "bg-orange-500 text-white shadow-lg shadow-orange-200" 
                  : "hover:bg-sky-100 text-slate-600"
              )}
            >
              <Upload size={18} className={activeSheet === 'upload' ? "text-white" : "text-sky-400 group-hover:text-blue-600"} />
              <span className="font-medium text-sm">Xử lý biên bản</span>
            </button>

            <button 
              onClick={() => { setActiveSheet('summary'); setIsSidebarOpen(false); }}
              className={cn(
                "w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all group",
                activeSheet === 'summary' 
                  ? "bg-orange-500 text-white shadow-lg shadow-orange-200" 
                  : "hover:bg-sky-100 text-slate-600"
              )}
            >
              <Database size={18} className={activeSheet === 'summary' ? "text-white" : "text-sky-400 group-hover:text-blue-600"} />
              <span className="font-medium text-sm">Kho dữ liệu tổng hợp</span>
            </button>
          </nav>

          <div className="pt-6 border-t border-sky-200">
            <div className="bg-sky-100/50 rounded-xl p-4">
              <p className="text-[10px] font-bold text-sky-500 uppercase tracking-widest mb-1">Current Version</p>
              <p className="text-xs font-medium text-blue-900">v2.1.0 Professional</p>
            </div>
          </div>
        </div>
      </aside>

      {/* Header */}
      <header className="bg-white border-b border-sky-200 px-8 py-4 flex items-center justify-between sticky top-0 z-30 shadow-sm backdrop-blur-md bg-white/90">
        <div 
          className="flex items-center gap-4 cursor-pointer group"
          onMouseEnter={() => setIsSidebarOpen(true)}
          onClick={() => setIsSidebarOpen(true)}
        >
          <div className="w-10 h-10 rounded-xl overflow-hidden flex items-center justify-center shadow-sm group-hover:scale-105 transition-transform border border-sky-200">
            {customLogo ? (
              <img src={customLogo} alt="Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div className="bg-blue-600 w-full h-full flex items-center justify-center">
                <Construction className="text-white w-5 h-5" />
              </div>
            )}
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight text-blue-900 uppercase leading-none">SGC - CKN</h1>
            <p className="text-[9px] text-sky-400 font-bold uppercase tracking-[0.15em] mt-1">
              Construction Management
            </p>
          </div>
          <div className="ml-2 p-1.5 bg-sky-50 rounded-lg text-sky-400 group-hover:text-blue-600 transition-colors">
            <Menu size={16} />
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {activeSheet === 'upload' && (
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="bg-orange-500 text-white px-5 py-2 rounded-xl text-xs font-bold hover:bg-orange-600 transition-all flex items-center gap-2 shadow-lg shadow-orange-100 uppercase tracking-widest"
            >
              <Upload size={14} />
              Quét biên bản
            </button>
          )}
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="p-2.5 bg-white border border-sky-200 text-sky-600 rounded-xl hover:bg-sky-50 transition-all shadow-sm"
          >
            <Settings size={18} />
          </button>
        </div>
      </header>

      <input type="file" ref={fileInputRef} className="hidden" accept="image/*,.pdf" multiple onChange={handleFileUpload} />

      <main className="flex-1 p-8 w-full space-y-10">
        {activeSheet === 'upload' ? (
          <div className="max-w-6xl mx-auto space-y-12">
            {/* Processing Queue */}
            {processingFiles.length > 0 && (
              <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight flex items-center gap-3">
                    <Loader2 className={cn("w-6 h-6 text-blue-600", isProcessing && "animate-spin")} />
                    Tiến trình xử lý ({processingFiles.filter(f => f.status !== 'completed').length})
                  </h3>
                  <div className="flex gap-4">
                    {processingFiles.every(f => f.status === 'completed' || f.status === 'error') && (
                      <button 
                        onClick={() => setProcessingFiles([])}
                        className="text-[10px] font-black text-slate-400 hover:text-red-500 uppercase tracking-widest transition-colors flex items-center gap-2"
                      >
                        <Trash2 size={14} />
                        Xóa danh sách
                      </button>
                    )}
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                  {processingFiles.map((file) => (
                    <div key={file.id} className="modern-card p-6 relative overflow-hidden group">
                      <div className="flex items-start justify-between mb-4">
                        <div className={cn(
                          "p-2.5 rounded-xl",
                          file.status === 'completed' ? "bg-emerald-50 text-emerald-600" : 
                          file.status === 'error' ? "bg-red-50 text-red-600" : "bg-slate-50 text-slate-600"
                        )}>
                          {file.status === 'completed' ? <CheckCircle2 size={20} /> : 
                           file.status === 'error' ? <AlertCircle size={20} /> : <FileText size={20} />}
                        </div>
                        <button 
                          onClick={() => removeProcessingFile(file.id)}
                          className="p-2 text-slate-300 hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                      <div className="space-y-3">
                        <h4 className="font-bold text-slate-900 truncate pr-4 text-sm" title={file.fileName}>{file.fileName}</h4>
                        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest">
                          <span className={cn(
                            file.status === 'completed' ? "text-emerald-600" : 
                            file.status === 'error' ? "text-red-600" : "text-slate-500"
                          )}>
                            {file.status === 'pending' ? 'Đang chờ...' : 
                             file.status === 'processing' ? 'Đang phân tích...' : 
                             file.status === 'completed' ? 'Hoàn thành' : 'Lỗi xử lý'}
                          </span>
                          <span className="text-slate-400">{file.progress}%</span>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div 
                            className={cn(
                              "h-full transition-all duration-500",
                              file.status === 'completed' ? "bg-emerald-500" : 
                              file.status === 'error' ? "bg-red-500" : "bg-orange-500"
                            )}
                            style={{ width: `${file.progress}%` }}
                          />
                        </div>
                      </div>
                      {file.status === 'completed' && file.result && (
                        <button 
                          onClick={() => setCurrentResult(file.result!)}
                          className="mt-5 w-full py-2.5 bg-blue-600 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-blue-700 transition-all flex items-center justify-center gap-2 shadow-lg shadow-blue-100"
                        >
                          <ExternalLink size={14} />
                          Kiểm tra & Lưu
                        </button>
                      )}
                      {file.status === 'error' && (
                        <div className="mt-3 p-3 bg-red-50 rounded-xl border border-red-100">
                          <p className="text-[10px] text-red-600 font-bold italic leading-tight">{file.error}</p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Current Selected Result */}
            {currentResult && (
              <div className="animate-in fade-in slide-in-from-bottom-8 duration-700 space-y-6">
                <div className="flex items-center justify-between bg-blue-600 p-8 rounded-3xl text-white shadow-xl">
                  <div className="flex items-center gap-5">
                    <div className="bg-white/10 p-3 rounded-2xl backdrop-blur-sm border border-white/10">
                      <FileText size={24} />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold uppercase tracking-tight">
                        {currentResult.fileName || currentResult.pileId}
                      </h3>
                      <p className="text-xs text-blue-100 font-bold uppercase tracking-widest mt-1">
                        {pendingResults.some(r => r.id === currentResult.id) ? "Đang chờ kiểm duyệt" : "Dữ liệu trích xuất thành công"}
                      </p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setCurrentResult(null)}
                    className="px-6 py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all border border-white/10 backdrop-blur-sm"
                  >
                    Đóng kết quả
                  </button>
                </div>
                <ResultDisplay 
                  result={currentResult} 
                  onSave={pendingResults.some(r => r.id === currentResult.id) ? saveResult : undefined}
                  onCancel={pendingResults.some(r => r.id === currentResult.id) ? cancelResult : undefined}
                />
              </div>
            )}

            {/* Pending Review Section */}
            {pendingResults.length > 0 && !currentResult && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <h3 className="text-xl font-bold text-slate-900 tracking-tight flex items-center gap-3">
                    <AlertCircle className="w-5 h-5 text-orange-500" />
                    Đang chờ kiểm duyệt ({pendingResults.length})
                  </h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {pendingResults.map((result) => (
                    <div 
                      key={result.id} 
                      className="modern-card p-6 relative group overflow-hidden"
                    >
                      <div className="absolute top-0 right-0 w-12 h-12 bg-orange-50 rounded-bl-2xl flex items-center justify-center text-orange-500">
                        <AlertCircle size={18} />
                      </div>
                      <h4 className="font-bold text-slate-900 uppercase tracking-tight text-sm mb-1 truncate pr-8">{result.pileId}</h4>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest truncate">{result.project}</p>
                      <div className="mt-6 flex gap-2">
                        <button 
                          onClick={() => cancelResult(result.id)}
                          className="flex-1 py-2 bg-slate-50 text-slate-400 rounded-xl text-[9px] font-bold uppercase tracking-widest hover:bg-red-50 hover:text-red-500 transition-all"
                        >
                          Hủy
                        </button>
                        <button 
                          onClick={() => setCurrentResult(result)}
                          className="flex-[2] py-2 bg-blue-600 text-white rounded-xl text-[9px] font-bold uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
                        >
                          Xem & Lưu
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Main Data Table on Sheet 1 */}
            {history.length > 0 && !currentResult && (
              <div className="space-y-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <h3 className="text-xl font-bold text-blue-900 tracking-tight flex items-center gap-3">
                      <div className="w-1.5 h-8 bg-orange-500 rounded-full" />
                      Dữ liệu thi công mới nhất
                    </h3>
                    {isGithubConnected ? (
                      <div className="flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full border border-emerald-100">
                        <Github size={12} fill="currentColor" />
                        <span className="text-[9px] font-bold uppercase tracking-widest">GitHub Connected</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 px-3 py-1 bg-sky-100 text-sky-400 rounded-full border border-sky-200">
                        <Github size={12} />
                        <span className="text-[9px] font-bold uppercase tracking-widest">GitHub Disconnected</span>
                      </div>
                    )}
                  </div>
                  <button 
                    onClick={() => setActiveSheet('summary')}
                    className="text-[10px] font-bold text-blue-600 hover:text-blue-800 uppercase tracking-widest transition-colors"
                  >
                    Xem tất cả
                  </button>
                </div>
                
                <div className="modern-card overflow-hidden">
                  <div className="overflow-x-auto custom-scrollbar">
                    <table className="pro-table">
                      <thead>
                        <tr>
                          <th>Dự án</th>
                          <th>Hạng mục</th>
                          <th>Tên bộ phận</th>
                          <th>Số hiệu</th>
                          <th>Đường kính</th>
                          <th>Bắt đầu</th>
                          <th>Kết thúc</th>
                          <th>Tập tin</th>
                          <th className="text-right">Thao tác</th>
                        </tr>
                      </thead>
                      <tbody className="">
                        {history.slice(0, 10).map((item) => (
                          <tr key={item.id} className="hover:bg-sky-50/80 transition-colors group">
                            <td className="font-bold text-blue-900">{item.project}</td>
                            <td className="text-slate-600">{item.item}</td>
                            <td className="text-slate-600">{item.componentName}</td>
                            <td className="font-bold text-blue-900">{item.pileId}</td>
                            <td className="font-medium text-slate-600">{item.diameter}</td>
                            <td className="text-slate-500">{item.constructionStart}</td>
                            <td className="text-slate-500">{item.constructionEnd}</td>
                            <td>
                              {item.fileUrl ? (
                                <a 
                                  href={item.fileUrl.includes('github') ? `/api/proxy/github?url=${encodeURIComponent(item.fileUrl)}` : item.fileUrl} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-1.5 text-blue-600 hover:text-blue-800 font-bold text-[10px] uppercase tracking-widest transition-colors"
                                >
                                  <ExternalLink size={12} />
                                  Xem
                                </a>
                              ) : (
                                <span className="text-sky-200 text-[10px] font-bold uppercase tracking-widest italic">Chưa có</span>
                              )}
                            </td>
                            <td className="text-right">
                              <div className="flex items-center justify-end gap-1.5">
                                <button 
                                  onClick={() => handleEdit(item)}
                                  className="p-2 bg-sky-50 text-blue-600 rounded-lg hover:bg-blue-600 hover:text-white transition-all shadow-sm border border-sky-100"
                                  title="Chỉnh sửa"
                                >
                                  <Edit2 size={14} />
                                </button>
                                <button 
                                  onClick={() => handleDelete(item.id)}
                                  className="p-2 bg-red-50 text-red-500 rounded-lg hover:bg-red-600 hover:text-white transition-all shadow-sm border border-red-100"
                                  title="Xóa"
                                >
                                  <Trash2 size={14} />
                                </button>
                                <button 
                                  onClick={() => setCurrentResult(item)}
                                  className="p-2 bg-sky-50 text-blue-600 rounded-lg hover:bg-blue-600 hover:text-white transition-all shadow-sm border border-sky-100"
                                  title="Xem chi tiết"
                                >
                                  <ChevronRight size={14} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          <SummaryView 
            history={history} 
            onSelectResult={(res) => { setCurrentResult(res); setActiveSheet('upload'); }} 
            onEdit={handleEdit}
            onDelete={handleDelete}
          />
        )}
      </main>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-blue-900/40 backdrop-blur-sm z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-3xl shadow-2xl overflow-hidden border border-sky-100">
            <div className="bg-blue-600 p-8 text-white flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="bg-white/10 p-2.5 rounded-xl backdrop-blur-sm border border-white/10">
                  <Settings size={20} />
                </div>
                <div>
                  <h3 className="text-lg font-bold uppercase tracking-tight leading-none">Cấu hình hệ thống</h3>
                  <p className="text-[10px] text-blue-100 font-bold uppercase tracking-widest mt-1.5">Quản lý API & Giao diện</p>
                </div>
              </div>
              <button onClick={() => setIsSettingsOpen(false)} className="p-2 hover:bg-white/10 rounded-full transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="p-8 space-y-8">
              <div className="space-y-6">
                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-sky-400 uppercase tracking-[0.2em] ml-1">Logo tùy chỉnh</label>
                  <div className="flex items-center gap-4 p-4 bg-sky-50 rounded-2xl border border-sky-100">
                    <div className="w-14 h-14 bg-white rounded-xl overflow-hidden flex items-center justify-center shadow-sm border border-sky-200">
                      {customLogo ? (
                        <img src={customLogo} alt="Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <Construction className="text-sky-300 w-6 h-6" />
                      )}
                    </div>
                    <div className="flex-1 space-y-2">
                      <button 
                        onClick={() => logoInputRef.current?.click()}
                        className="w-full py-2 bg-white border border-sky-200 rounded-lg text-[10px] font-bold uppercase tracking-widest text-blue-900 hover:bg-sky-50 transition-colors flex items-center justify-center gap-2"
                      >
                        <ImageIcon size={14} />
                        Thay đổi Logo
                      </button>
                      {customLogo && (
                        <button 
                          onClick={resetLogo}
                          className="w-full py-2 bg-white border border-sky-200 rounded-lg text-[10px] font-bold uppercase tracking-widest text-red-500 hover:bg-red-50 transition-colors flex items-center justify-center gap-2"
                        >
                          <RotateCcw size={14} />
                          Đặt lại mặc định
                        </button>
                      )}
                    </div>
                    <input type="file" ref={logoInputRef} className="hidden" accept="image/*" onChange={handleLogoUpload} />
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-sky-400 uppercase tracking-[0.2em] ml-1">Kết nối GitHub</label>
                  <div className="p-4 bg-sky-50 rounded-2xl border border-sky-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={cn("p-2 rounded-lg", isGithubConnected ? "bg-emerald-100 text-emerald-600" : "bg-sky-200 text-sky-400")}>
                        <Github size={18} />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-blue-900 uppercase tracking-tight">
                          {isGithubConnected ? "GitHub Connected" : "GitHub Disconnected"}
                        </p>
                        <p className="text-[9px] text-sky-400 font-bold uppercase tracking-widest leading-none mt-1">
                          {isGithubConnected ? "Auto-sync enabled" : "Setup token to sync"}
                        </p>
                      </div>
                    </div>
                    <button 
                      onClick={connectGithub}
                      disabled={isConnectingGithub}
                      className={cn(
                        "px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest transition-all",
                        isGithubConnected 
                          ? "bg-emerald-50 text-emerald-600 hover:bg-emerald-100" 
                          : "bg-orange-500 text-white hover:bg-orange-600 shadow-lg shadow-orange-100"
                      )}
                    >
                      {isConnectingGithub ? "..." : isGithubConnected ? "Active" : "Connect"}
                    </button>
                  </div>
                </div>

                <div className="space-y-3">
                  <label className="text-[10px] font-bold text-sky-400 uppercase tracking-[0.2em] ml-1">Gemini API Key</label>
                  <div className="relative">
                    <input 
                      type="password"
                      value={userApiKey}
                      onChange={(e) => setUserApiKey(e.target.value)}
                      placeholder="Nhập API Key của bạn..."
                      className="w-full bg-sky-50 border border-sky-200 rounded-2xl px-5 py-3.5 text-blue-900 font-medium focus:border-blue-600 focus:ring-0 transition-all outline-none text-sm"
                    />
                  </div>
                </div>
              </div>
              <button 
                onClick={() => saveApiKey(userApiKey)}
                className="w-full bg-blue-600 text-white py-4 rounded-2xl font-bold uppercase tracking-widest flex items-center justify-center gap-3 shadow-lg shadow-blue-100 hover:bg-blue-700 transition-all active:scale-95"
              >
                <Save size={18} />
                Lưu cấu hình
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="bg-sky-50 border-t border-sky-200 px-8 py-8 text-center mt-auto">
        <p className="text-slate-400 text-[11px] font-black uppercase tracking-[0.4em]">
          Hệ thống SGC - CKN • Giải pháp dữ liệu xây dựng
        </p>
      </footer>

      {/* Edit Split View Modal */}
      {isEditModalOpen && editingResult && (
        <EditSplitView 
          result={editingResult} 
          onClose={() => { setIsEditModalOpen(false); setEditingResult(null); }}
          onSave={handleSaveEdit}
        />
      )}
    </div>
  );
}

function ResultDisplay({ result, onSave, onCancel }: { result: ExtractionResult; onSave?: (res: ExtractionResult) => void; onCancel?: (id: string) => void }) {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-12 duration-1000">
      {/* Review Actions */}
      {(onSave || onCancel) && (
        <div className="flex items-center justify-between bg-white border border-slate-200 p-8 rounded-3xl shadow-xl relative overflow-hidden">
          <div className="absolute top-0 left-0 w-1.5 h-full bg-orange-500" />
          <div className="flex items-center gap-5">
            <div className="bg-orange-50 p-3 rounded-2xl text-orange-600">
              <AlertCircle size={24} />
            </div>
            <div>
              <h4 className="text-lg font-bold text-slate-900 uppercase tracking-tight">Kiểm tra dữ liệu trích xuất</h4>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest mt-1">Dữ liệu cần được xác nhận trước khi lưu</p>
            </div>
          </div>
          <div className="flex gap-4">
            {onCancel && (
              <button 
                onClick={() => onCancel(result.id)}
                className="px-6 py-3 bg-white text-slate-400 rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-slate-50 transition-all border border-slate-200 shadow-sm flex items-center gap-2"
              >
                <X size={16} />
                Hủy bỏ
              </button>
            )}
            {onSave && (
              <button 
                onClick={() => onSave(result)}
                className="px-8 py-3 bg-slate-900 text-white rounded-xl text-[10px] font-bold uppercase tracking-widest hover:bg-slate-800 transition-all shadow-lg shadow-slate-200 flex items-center gap-2"
              >
                <Save size={16} />
                Lưu dữ liệu
              </button>
            )}
          </div>
        </div>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard title="Số hiệu cọc" value={result.pileId} icon={<Layers className="text-blue-600" />} />
        <StatCard title="Đường kính" value={result.diameter} icon={<Activity className="text-blue-600" />} />
        <StatCard title="Bắt đầu" value={result.constructionStart} icon={<Calendar className="text-blue-600" />} />
        <StatCard title="Kết thúc" value={result.constructionEnd} icon={<Calendar className="text-blue-600" />} />
      </div>

      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="text-xl font-bold text-blue-900 tracking-tight flex items-center gap-3">
            <div className="w-1.5 h-8 bg-orange-500 rounded-full" />
            Chi tiết các lớp địa chất
          </h3>
          <p className="text-xs text-sky-400 font-medium ml-4">Thông số kỹ thuật trích xuất từ biên bản</p>
        </div>
        <div className="flex gap-2">
          <div className="px-3 py-1.5 bg-sky-50 text-sky-600 rounded-lg text-[10px] font-bold uppercase tracking-widest border border-sky-100">
            {result.layers.length} Lớp
          </div>
          <div className="px-3 py-1.5 bg-sky-50 text-sky-600 rounded-lg text-[10px] font-bold uppercase tracking-widest border border-sky-100">
            TB: {(result.layers.reduce((acc, l) => acc + l.speedMph, 0) / result.layers.length).toFixed(2)} m/h
          </div>
        </div>
      </div>

      <div className="modern-card overflow-hidden">
        <div className="overflow-x-auto custom-scrollbar">
          <table className="pro-table min-w-[2000px]">
            <thead>
              <tr>
                <th className="sticky left-0 bg-sky-100 z-10">Dự án</th>
                <th>Hạng mục</th>
                <th>Tên bộ phận</th>
                <th>Số hiệu cọc</th>
                <th>Đường kính</th>
                <th>Bắt đầu thi công</th>
                <th>Kết thúc thi công</th>
                <th>Lớp thiết kế</th>
                <th>Bắt đầu khoan</th>
                <th>Kết thúc khoan</th>
                <th className="text-center">Thời gian (h)</th>
                <th className="text-center">Cao độ đầu</th>
                <th className="text-center">Cao độ cuối</th>
                <th className="text-center">Chiều dài (m)</th>
                <th className="text-right">Tốc độ (m/h)</th>
              </tr>
            </thead>
            <tbody className="">
              {result.layers.map((layer, idx) => (
                <tr key={idx} className="hover:bg-sky-50/80 transition-colors group">
                  <td className="sticky left-0 bg-white group-hover:bg-sky-50 z-10 font-bold text-blue-900">{layer.project}</td>
                  <td className="text-slate-600">{layer.item}</td>
                  <td className="text-blue-900 font-medium">{layer.componentName}</td>
                  <td className="font-bold text-blue-900">{layer.pileId}</td>
                  <td className="text-slate-600">{layer.diameter}</td>
                  <td className="text-slate-500">{layer.constructionStart}</td>
                  <td className="text-slate-500">{layer.constructionEnd}</td>
                  <td className="text-slate-600 italic text-xs min-w-[300px] leading-relaxed">{layer.layerDesign}</td>
                  <td className="font-bold text-blue-900">{layer.timeFrom}</td>
                  <td className="font-bold text-blue-900">{layer.timeTo}</td>
                  <td className="text-center font-bold text-blue-900 bg-sky-50/30">{layer.durationHours.toFixed(2)}</td>
                  <td className="text-center text-slate-600">{layer.elevationFrom}</td>
                  <td className="text-center text-slate-600">{layer.elevationTo}</td>
                  <td className="text-center font-bold text-blue-900">{layer.lengthMeters.toFixed(2)}</td>
                  <td className="text-right">
                    <span className={cn(
                      "inline-flex items-center px-3 py-1 rounded-lg text-[10px] font-bold uppercase tracking-widest",
                      layer.speedMph > 5 ? "bg-emerald-50 text-emerald-600 border border-emerald-100" : "bg-orange-50 text-orange-600 border border-orange-100"
                    )}>
                      {layer.speedMph.toFixed(2)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        <div className="modern-card p-10 md:col-span-2 bg-blue-900 text-white relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-white/5 rounded-full -mr-32 -mt-32" />
          <h4 className="text-sky-400 font-bold uppercase tracking-[0.3em] text-[10px] mb-6 flex items-center gap-2">
            <Activity size={14} />
            Phân tích năng suất địa chất
          </h4>
          <p className="text-blue-50 text-lg leading-relaxed font-medium italic relative z-10">
            "{result.summary}"
          </p>
        </div>
        <div className="modern-card p-10 flex flex-col justify-center items-center text-center">
          <h4 className="text-sky-400 font-bold uppercase tracking-widest text-[10px] mb-4">Tốc độ khoan trung bình</h4>
          <div className="flex items-baseline gap-2">
            <span className="text-6xl font-bold text-blue-900 tracking-tighter">
              {(result.layers.reduce((acc, l) => acc + l.speedMph, 0) / result.layers.length).toFixed(2)}
            </span>
            <span className="text-sky-400 font-bold uppercase tracking-widest text-xs">m/h</span>
          </div>
          <div className="mt-8 w-full h-1.5 bg-sky-100 rounded-full overflow-hidden">
            <div 
              className="h-full bg-orange-500 transition-all duration-1000" 
              style={{ width: `${Math.min(100, (result.layers.reduce((acc, l) => acc + l.speedMph, 0) / result.layers.length) * 10)}%` }} 
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryView({ 
  history, 
  onSelectResult, 
  onEdit, 
  onDelete 
}: { 
  history: ExtractionResult[], 
  onSelectResult: (res: ExtractionResult) => void,
  onEdit: (res: ExtractionResult) => void,
  onDelete: (id: string) => void
}) {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-12 duration-1000">
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <h3 className="text-2xl font-bold text-blue-900 tracking-tight flex items-center gap-3">
            <div className="w-1.5 h-8 bg-orange-500 rounded-full" />
            Tổng hợp dữ liệu thi công
          </h3>
          <p className="text-xs text-sky-400 font-medium ml-4">Quản lý và theo dõi lịch sử trích xuất dữ liệu</p>
        </div>
        <div className="flex items-center gap-4">
          <div className="bg-white border border-sky-200 rounded-2xl px-5 py-2.5 shadow-sm">
            <p className="text-[9px] font-bold text-sky-400 uppercase tracking-widest mb-0.5">Tổng số cọc</p>
            <p className="text-xl font-bold text-blue-900">{history.length}</p>
          </div>
        </div>
      </div>

      {history.length === 0 ? (
        <div className="bg-white border border-sky-200 border-dashed rounded-3xl py-32 flex flex-col items-center justify-center text-center shadow-sm">
          <div className="bg-slate-50 p-6 rounded-full mb-6">
            <History className="text-slate-300 w-10 h-10" />
          </div>
          <h4 className="text-lg font-bold text-slate-400 uppercase tracking-widest">Chưa có dữ liệu lịch sử</h4>
          <p className="text-slate-400 mt-2 text-sm">Hãy bắt đầu bằng cách quét biên bản đầu tiên</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          <div className="modern-card overflow-hidden">
            <div className="overflow-x-auto custom-scrollbar">
              <table className="pro-table">
                <thead>
                  <tr>
                    <th>Dự án</th>
                    <th>Hạng mục</th>
                    <th>Tên bộ phận</th>
                    <th>Số hiệu cọc</th>
                    <th>Đường kính</th>
                    <th>Bắt đầu</th>
                    <th>Kết thúc</th>
                    <th>Tập tin</th>
                    <th className="text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="">
                  {history.map((item) => (
                    <tr key={item.id} className="hover:bg-sky-50/80 transition-colors group">
                      <td className="font-bold text-blue-900">{item.project}</td>
                      <td className="text-slate-600">{item.item}</td>
                      <td className="text-slate-600">{item.componentName}</td>
                      <td className="font-bold text-blue-900">{item.pileId}</td>
                      <td className="font-medium text-slate-600">{item.diameter}</td>
                      <td className="text-slate-500">{item.constructionStart}</td>
                      <td className="text-slate-500">{item.constructionEnd}</td>
                      <td>
                        {item.fileUrl ? (
                          <a 
                            href={item.fileUrl.includes('github') ? `/api/proxy/github?url=${encodeURIComponent(item.fileUrl)}` : item.fileUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex items-center gap-1.5 text-blue-600 hover:text-blue-800 font-bold text-[10px] uppercase tracking-widest transition-colors"
                          >
                            <ExternalLink size={12} />
                            Xem
                          </a>
                        ) : (
                          <span className="text-sky-200 text-[10px] font-bold uppercase tracking-widest italic">Chưa có</span>
                        )}
                      </td>
                      <td className="text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button 
                            onClick={() => onEdit(item)}
                            className="p-2 bg-sky-50 text-blue-600 rounded-lg hover:bg-blue-600 hover:text-white transition-all shadow-sm border border-sky-100"
                            title="Chỉnh sửa"
                          >
                            <Edit2 size={14} />
                          </button>
                          <button 
                            onClick={() => onDelete(item.id)}
                            className="p-2 bg-red-50 text-red-500 rounded-lg hover:bg-red-600 hover:text-white transition-all shadow-sm border border-red-100"
                            title="Xóa"
                          >
                            <Trash2 size={14} />
                          </button>
                          <button 
                            onClick={() => onSelectResult(item)}
                            className="p-2 bg-sky-50 text-blue-600 rounded-lg hover:bg-blue-600 hover:text-white transition-all shadow-sm border border-sky-100"
                            title="Xem chi tiết"
                          >
                            <ChevronRight size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ title, value, icon }: { title: string; value: string; icon: React.ReactNode }) {
  return (
    <div className="modern-card p-6 group">
      <div className="flex items-center justify-between mb-4">
        <div className="p-2.5 bg-sky-50 rounded-xl group-hover:bg-sky-100 transition-colors">
          {icon}
        </div>
        <div className="h-1 w-10 bg-sky-100 rounded-full overflow-hidden">
          <div className="h-full bg-orange-500 w-1/3 group-hover:w-full transition-all duration-700" />
        </div>
      </div>
      <span className="text-[9px] font-bold uppercase tracking-[0.2em] text-sky-400 block mb-1">{title}</span>
      <div className="text-xl font-bold text-blue-900 truncate" title={value}>
        {value || "---"}
      </div>
    </div>
  );
}

function EditSplitView({ 
  result, 
  onClose, 
  onSave 
}: { 
  result: ExtractionResult; 
  onClose: () => void; 
  onSave: (res: ExtractionResult) => void 
}) {
  const [data, setData] = useState<ExtractionResult>(result);
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [displayUrl, setDisplayUrl] = useState<string | null>(result.fileUrl || null);
  const [isPdf, setIsPdf] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [numPages, setNumPages] = useState<number>(0);
  const [pageNumber, setPageNumber] = useState<number>(1);

  useEffect(() => {
    async function loadFile() {
      if (!data.fileUrl) {
        setDisplayUrl(null);
        setLoadError(null);
        return;
      }

      const url = data.fileUrl;
      const cleanUrl = url.split('?')[0].toLowerCase();
      const isPdfFile = cleanUrl.endsWith('.pdf') || url.includes('mimeType=application/pdf');
      
      setIsPdf(isPdfFile);
      setLoadError(null);
      setIsLoading(true);

      // If it's a GitHub URL, use our proxy directly as the source
      if (url.includes('githubusercontent.com') || url.includes('github.com')) {
        const proxyUrl = `/api/proxy/github?url=${encodeURIComponent(url)}`;
        setDisplayUrl(proxyUrl);
      } else {
        setDisplayUrl(url);
      }
      setIsLoading(false);
    }

    loadFile();
  }, [data.fileUrl]);

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.25, 5));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.25, 0.5));
  const handleResetZoom = () => {
    setZoom(1);
    setPosition({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (isPdf) return;
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging || isPdf) return;
    setPosition({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
  };

  const handleMouseUp = () => setIsDragging(false);

  const updateField = (field: keyof ExtractionResult, value: string) => {
    setData(prev => ({ ...prev, [field]: value }));
  };

  const updateLayer = (idx: number, field: keyof DrillLayer, value: any) => {
    const newLayers = [...data.layers];
    newLayers[idx] = { ...newLayers[idx], [field]: value };
    
    // Recalculate duration and speed if times or elevations change
    if (['timeFrom', 'timeTo', 'elevationFrom', 'elevationTo'].includes(field as string)) {
      const layer = newLayers[idx];
      const start = new Date(`2000-01-01T${layer.timeFrom}`);
      const end = new Date(`2000-01-01T${layer.timeTo}`);
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        let diff = (end.getTime() - start.getTime()) / (1000 * 60 * 60);
        if (diff < 0) diff += 24;
        layer.durationHours = diff;
      }
      
      const elevStart = parseFloat(layer.elevationFrom.toString());
      const elevEnd = parseFloat(layer.elevationTo.toString());
      if (!isNaN(elevStart) && !isNaN(elevEnd)) {
        layer.lengthMeters = Math.abs(elevEnd - elevStart);
        if (layer.durationHours > 0) {
          layer.speedMph = layer.lengthMeters / layer.durationHours;
        }
      }
    }
    
    setData(prev => ({ ...prev, layers: newLayers }));
  };

  const onDocumentLoadSuccess = ({ numPages }: { numPages: number }) => {
    setNumPages(numPages);
    setPageNumber(1);
  };

  return (
    <div className="fixed inset-0 bg-white z-[200] flex flex-col animate-in fade-in duration-300">
      {/* Header */}
      <div className="h-16 bg-sky-50 border-b border-sky-100 flex items-center justify-between px-6 shrink-0">
        <div className="flex items-center gap-4">
          <div className="bg-blue-600 p-2 rounded-lg text-white">
            <Edit2 size={18} />
          </div>
          <div>
            <h3 className="text-sm font-black text-blue-900 uppercase tracking-tight">Chỉnh sửa dữ liệu: {data.pileId}</h3>
            <p className="text-[10px] text-sky-400 font-bold uppercase tracking-widest">{data.project}</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button 
            onClick={onClose}
            className="px-4 py-2 bg-sky-100 text-sky-600 rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-sky-200 transition-colors"
          >
            Hủy bỏ
          </button>
          <button 
            onClick={() => onSave(data)}
            className="px-6 py-2 bg-emerald-600 text-white rounded-lg text-[10px] font-black uppercase tracking-widest hover:bg-emerald-700 transition-all shadow-lg shadow-emerald-900/20 flex items-center gap-2"
          >
            <Save size={14} />
            Lưu thay đổi
          </button>
        </div>
      </div>

      {/* Main Content Split */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Data Form */}
        <div className="w-1/2 border-r border-sky-100 bg-white overflow-y-auto p-8 space-y-8 custom-scrollbar">
          <div className="grid grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-[10px] font-black text-sky-400 uppercase tracking-widest">Dự án</label>
              <input 
                value={data.project} 
                onChange={(e) => updateField('project', e.target.value)}
                className="w-full bg-sky-50/50 border border-sky-100 rounded-xl px-4 py-3 text-sm text-blue-900 font-medium focus:border-blue-500 outline-none transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-sky-400 uppercase tracking-widest">Hạng mục</label>
              <input 
                value={data.item} 
                onChange={(e) => updateField('item', e.target.value)}
                className="w-full bg-sky-50/50 border border-sky-100 rounded-xl px-4 py-3 text-sm text-blue-900 font-medium focus:border-blue-500 outline-none transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-sky-400 uppercase tracking-widest">Tên bộ phận</label>
              <input 
                value={data.componentName} 
                onChange={(e) => updateField('componentName', e.target.value)}
                className="w-full bg-sky-50/50 border border-sky-100 rounded-xl px-4 py-3 text-sm text-blue-900 font-medium focus:border-blue-500 outline-none transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-sky-400 uppercase tracking-widest">Số hiệu cọc</label>
              <input 
                value={data.pileId} 
                onChange={(e) => updateField('pileId', e.target.value)}
                className="w-full bg-sky-50/50 border border-sky-100 rounded-xl px-4 py-3 text-sm text-blue-900 font-medium focus:border-blue-500 outline-none transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-sky-400 uppercase tracking-widest">Đường kính</label>
              <input 
                value={data.diameter} 
                onChange={(e) => updateField('diameter', e.target.value)}
                className="w-full bg-sky-50/50 border border-sky-100 rounded-xl px-4 py-3 text-sm text-blue-900 font-medium focus:border-blue-500 outline-none transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-sky-400 uppercase tracking-widest">Bắt đầu thi công</label>
              <input 
                value={data.constructionStart} 
                onChange={(e) => updateField('constructionStart', e.target.value)}
                className="w-full bg-sky-50/50 border border-sky-100 rounded-xl px-4 py-3 text-sm text-blue-900 font-medium focus:border-blue-500 outline-none transition-all"
              />
            </div>
            <div className="space-y-2">
              <label className="text-[10px] font-black text-sky-400 uppercase tracking-widest">Kết thúc thi công</label>
              <input 
                value={data.constructionEnd} 
                onChange={(e) => updateField('constructionEnd', e.target.value)}
                className="w-full bg-sky-50/50 border border-sky-100 rounded-xl px-4 py-3 text-sm text-blue-900 font-medium focus:border-blue-500 outline-none transition-all"
              />
            </div>
          </div>

          <div className="space-y-4">
            <h4 className="text-xs font-black text-blue-600 uppercase tracking-widest flex items-center gap-2">
              <Layers size={14} />
              Chi tiết các lớp địa chất
            </h4>
            <div className="overflow-x-auto border border-sky-100 rounded-xl custom-scrollbar">
              <table className="pro-table min-w-[1200px]">
                <thead>
                  <tr>
                    <th>Lớp thiết kế</th>
                    <th>Từ (h)</th>
                    <th>Đến (h)</th>
                    <th>Cao độ từ</th>
                    <th>Cao độ đến</th>
                    <th>Thời gian (h)</th>
                    <th>Chiều dài (m)</th>
                    <th>Tốc độ (m/h)</th>
                  </tr>
                </thead>
                <tbody className="">
                  {data.layers.map((layer, idx) => (
                    <tr key={idx} className="hover:bg-sky-50 transition-colors">
                      <td className="p-0">
                        <input 
                          value={layer.layerDesign} 
                          onChange={(e) => updateLayer(idx, 'layerDesign', e.target.value)}
                          className="w-full h-full bg-transparent border-none text-xs text-blue-900 font-medium focus:ring-2 focus:ring-blue-500/20 px-4 py-3 outline-none"
                        />
                      </td>
                      <td className="p-0">
                        <input 
                          type="time"
                          value={layer.timeFrom} 
                          onChange={(e) => updateLayer(idx, 'timeFrom', e.target.value)}
                          className="w-full h-full bg-transparent border-none text-xs text-blue-600 font-black focus:ring-2 focus:ring-blue-500/20 px-4 py-3 outline-none"
                        />
                      </td>
                      <td className="p-0">
                        <input 
                          type="time"
                          value={layer.timeTo} 
                          onChange={(e) => updateLayer(idx, 'timeTo', e.target.value)}
                          className="w-full h-full bg-transparent border-none text-xs text-blue-600 font-black focus:ring-2 focus:ring-blue-500/20 px-4 py-3 outline-none"
                        />
                      </td>
                      <td className="p-0">
                        <input 
                          type="number"
                          step="0.1"
                          value={layer.elevationFrom} 
                          onChange={(e) => updateLayer(idx, 'elevationFrom', e.target.value)}
                          className="w-full h-full bg-transparent border-none text-xs text-blue-900 font-bold focus:ring-2 focus:ring-blue-500/20 px-4 py-3 outline-none text-center"
                        />
                      </td>
                      <td className="p-0">
                        <input 
                          type="number"
                          step="0.1"
                          value={layer.elevationTo} 
                          onChange={(e) => updateLayer(idx, 'elevationTo', e.target.value)}
                          className="w-full h-full bg-transparent border-none text-xs text-blue-900 font-bold focus:ring-2 focus:ring-blue-500/20 px-4 py-3 outline-none text-center"
                        />
                      </td>
                      <td className="px-4 py-3 text-xs font-black text-sky-400 text-center bg-sky-50/50">
                        {layer.durationHours.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-xs font-black text-sky-400 text-center bg-sky-50/50">
                        {layer.lengthMeters.toFixed(2)}
                      </td>
                      <td className="px-4 py-3 text-xs font-black text-emerald-600 text-center bg-emerald-50/30">
                        {layer.speedMph.toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-[10px] font-black text-sky-400 uppercase tracking-widest">Tóm tắt phân tích</label>
            <textarea 
              value={data.summary} 
              onChange={(e) => updateField('summary', e.target.value)}
              rows={4}
              className="w-full bg-sky-50/50 border border-sky-100 rounded-xl px-4 py-3 text-sm text-blue-900 font-medium focus:border-blue-500 outline-none transition-all resize-none"
            />
          </div>
        </div>

        {/* Right: File Viewer */}
        <div className="w-1/2 bg-white relative overflow-hidden group flex flex-col">
          {/* Toolbar for Viewer */}
          {displayUrl && (
            <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-20 opacity-0 group-hover:opacity-100 transition-opacity">
              <div className="flex gap-2">
                <a 
                  href={displayUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-white/90 backdrop-blur-md rounded-xl text-blue-900 text-[10px] font-black uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all border border-sky-100 shadow-2xl flex items-center gap-2"
                >
                  <ExternalLink size={14} />
                  Mở tab mới
                </a>
                <a 
                  href={displayUrl} 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-white/90 backdrop-blur-md rounded-xl text-blue-900 text-[10px] font-black uppercase tracking-widest hover:bg-emerald-600 hover:text-white transition-all border border-sky-100 shadow-2xl flex items-center gap-2"
                >
                  <ArrowDownToLine size={14} />
                  Tải xuống
                </a>
              </div>
              
              {isPdf && numPages > 0 && (
                <div className="flex items-center gap-3 bg-white/90 backdrop-blur-md px-4 py-2 rounded-xl border border-sky-100 shadow-2xl">
                  <button 
                    onClick={() => setPageNumber(p => Math.max(1, p - 1))}
                    disabled={pageNumber <= 1}
                    className="text-blue-900 disabled:opacity-30 hover:text-blue-600 transition-colors"
                  >
                    <ChevronLeft size={18} />
                  </button>
                  <span className="text-[10px] font-black text-blue-900 uppercase tracking-widest min-w-[60px] text-center">
                    {pageNumber} / {numPages}
                  </span>
                  <button 
                    onClick={() => setPageNumber(p => Math.min(numPages, p + 1))}
                    disabled={pageNumber >= numPages}
                    className="text-blue-900 disabled:opacity-30 hover:text-blue-600 transition-colors"
                  >
                    <ChevronRight size={18} />
                  </button>
                </div>
              )}
            </div>
          )}

          {isLoading ? (
            <div className="w-full h-full flex flex-col items-center justify-center text-sky-400 gap-4">
              <Loader2 size={48} className="animate-spin text-blue-500" />
              <p className="text-xs font-black uppercase tracking-widest opacity-60">Đang tải tài liệu...</p>
            </div>
          ) : loadError ? (
            <div className="w-full h-full flex flex-col items-center justify-center text-red-500 gap-4 p-8 text-center">
              <AlertCircle size={48} className="opacity-50" />
              <div>
                <p className="text-sm font-black uppercase tracking-widest">Lỗi tải tài liệu</p>
                <p className="text-[10px] opacity-60 mt-1">{loadError}</p>
              </div>
              <button 
                onClick={() => setDisplayUrl(displayUrl)} 
                className="mt-4 px-6 py-2 bg-sky-50 hover:bg-sky-100 text-blue-900 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all"
              >
                Thử lại
              </button>
            </div>
          ) : displayUrl ? (
            isPdf ? (
              <div className="w-full h-full bg-sky-50/50 overflow-auto flex justify-center p-8 custom-scrollbar">
                <div 
                  className="shadow-2xl bg-white origin-top transition-transform duration-200"
                  style={{ transform: `scale(${zoom})` }}
                >
                  <Document
                    file={displayUrl}
                    onLoadSuccess={onDocumentLoadSuccess}
                    onLoadError={(err) => {
                      console.error("PDF Load Error:", err);
                      setLoadError("Không thể tải file PDF. Vui lòng thử mở trong tab mới.");
                    }}
                    loading={
                      <div className="flex flex-col items-center justify-center p-20">
                        <Loader2 className="w-8 h-8 text-blue-600 animate-spin mb-2" />
                        <p className="text-sm text-sky-500">Đang tải PDF...</p>
                      </div>
                    }
                  >
                    <Page 
                      pageNumber={pageNumber} 
                      renderTextLayer={true}
                      renderAnnotationLayer={true}
                      className="max-w-full"
                    />
                  </Document>
                </div>
              </div>
            ) : (
              <div 
                className="w-full h-full flex items-center justify-center cursor-move bg-sky-50/50"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
              >
                <div 
                  style={{ 
                    transform: `translate(${position.x}px, ${position.y}px) scale(${zoom})`,
                    transition: isDragging ? 'none' : 'transform 0.2s ease-out'
                  }}
                  className="flex items-center justify-center min-h-full min-w-full"
                >
                  <img 
                    src={displayUrl} 
                    alt="Tài liệu đã quét" 
                    className="max-w-none shadow-2xl bg-white"
                    style={{ maxHeight: '90vh' }}
                    draggable={false}
                    referrerPolicy="no-referrer"
                    onError={(e) => {
                      console.error("Image load failed", e);
                      // Try to fetch the error message from proxy if it failed
                      fetch(displayUrl!)
                        .then(res => {
                          if (!res.ok) return res.text();
                          return null;
                        })
                        .then(text => {
                          if (text) setLoadError(text);
                          else setLoadError("Không thể hiển thị hình ảnh. Vui lòng thử mở trong tab mới.");
                        })
                        .catch(() => {
                          setLoadError("Không thể hiển thị hình ảnh. Vui lòng thử mở trong tab mới.");
                        });
                    }}
                  />
                </div>
              </div>
            )
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center text-sky-600 gap-4">
              <ImageIcon size={64} className="opacity-20" />
              <p className="text-sm font-black uppercase tracking-widest opacity-40">Không tìm thấy tệp tài liệu</p>
            </div>
          )}

          {/* Zoom Controls */}
          {displayUrl && (
            <div className="absolute bottom-8 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-white/80 backdrop-blur-md p-2 rounded-2xl border border-sky-100 shadow-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300">
              <button 
                onClick={handleZoomOut}
                className="p-3 hover:bg-sky-50 rounded-xl text-blue-900 transition-colors"
                title="Thu nhỏ"
              >
                <ZoomOutIcon size={20} />
              </button>
              <div className="w-16 text-center text-[10px] font-black text-blue-900 uppercase tracking-widest">
                {Math.round(zoom * 100)}%
              </div>
              <button 
                onClick={handleZoomIn}
                className="p-3 hover:bg-sky-50 rounded-xl text-blue-900 transition-colors"
                title="Phóng to"
              >
                <ZoomInIcon size={20} />
              </button>
              <div className="w-px h-6 bg-sky-100 mx-1" />
              <button 
                onClick={handleResetZoom}
                className="p-3 hover:bg-sky-50 rounded-xl text-blue-900 transition-colors"
                title="Đặt lại"
              >
                <RotateCcw size={20} />
              </button>
            </div>
          )}

          {/* Fullscreen Hint */}
          <div className="absolute top-6 right-6 p-3 bg-sky-100/40 rounded-xl text-sky-400 pointer-events-none">
            <Maximize2 size={16} />
          </div>
        </div>
      </div>
    </div>
  );
}
