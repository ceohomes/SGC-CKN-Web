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
  Cloud
} from 'lucide-react';
import { GoogleGenAI, Type } from "@google/genai";
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { supabase } from './supabase';

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
  if (!text) throw new Error("No response from AI");
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
  const [isOneDriveConnected, setIsOneDriveConnected] = useState<boolean>(false);
  const [isConnectingOneDrive, setIsConnectingOneDrive] = useState<boolean>(false);
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

    const checkOneDriveStatus = async () => {
      try {
        const res = await fetch('/api/auth/onedrive/status');
        const data = await res.json();
        setIsOneDriveConnected(data.connected);
      } catch (e) {
        console.error("Failed to check OneDrive status", e);
      }
    };
    checkOneDriveStatus();

    // Periodic check every 30 seconds
    const statusInterval = setInterval(checkOneDriveStatus, 30000);

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'ONEDRIVE_AUTH_SUCCESS') {
        setIsOneDriveConnected(true);
        setIsConnectingOneDrive(false);
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

  const connectOneDrive = async () => {
    setIsConnectingOneDrive(true);
    try {
      const res = await fetch('/api/auth/onedrive/url');
      const { url } = await res.json();
      window.open(url, 'onedrive_auth', 'width=600,height=700');
    } catch (e) {
      console.error("Failed to get OneDrive auth URL", e);
      setIsConnectingOneDrive(false);
    }
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

        // Upload to OneDrive if connected
        if (isOneDriveConnected) {
          try {
            console.log("Attempting OneDrive upload for:", file.name);
            setProcessingFiles(prev => prev.map(f => f.id === pFile.id ? { ...f, progress: 90 } : f));
            const uploadRes = await fetch('/api/onedrive/upload', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ fileName: file.name, base64Data: base64 })
            });
            const uploadData = await uploadRes.json();
            console.log("OneDrive upload response:", uploadData);
            if (uploadData.fileUrl) {
              result.fileUrl = uploadData.fileUrl;
              console.log("File URL assigned to result:", result.fileUrl);
            } else {
              console.warn("OneDrive upload succeeded but no fileUrl returned:", uploadData);
            }
          } catch (e) {
            console.error("OneDrive upload failed", e);
          }
        } else {
          console.log("OneDrive not connected, skipping upload.");
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
    
    if (isOneDriveConnected && !result.fileUrl) {
      const proceed = window.confirm("Cảnh báo: OneDrive đã kết nối nhưng không tìm thấy link file. Bạn có muốn tiếp tục lưu mà không có file không?");
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
          "fixed top-0 left-0 h-full w-80 bg-white z-50 shadow-2xl transition-transform duration-500 ease-out transform",
          isSidebarOpen ? "translate-x-0" : "-translate-x-full"
        )}
        onMouseLeave={() => setIsSidebarOpen(false)}
      >
        <div className="p-8 h-full flex flex-col">
          <div className="flex items-center justify-between mb-12">
            <div className="flex items-center gap-4">
              <div className="w-16 h-16 rounded-2xl overflow-hidden flex items-center justify-center shadow-lg border-2 border-slate-100">
                {customLogo ? (
                  <img src={customLogo} alt="Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                ) : (
                  <div className="bg-orange-500 w-full h-full flex items-center justify-center shadow-inner">
                    <ArrowDownToLine className="text-white w-8 h-8" />
                  </div>
                )}
              </div>
              <div>
                <span className="font-black text-blue-900 uppercase tracking-tight block text-xl">SGC - CKN</span>
              </div>
            </div>
            <button onClick={() => setIsSidebarOpen(false)} className="p-2 hover:bg-slate-100 rounded-full transition-colors">
              <X className="w-5 h-5 text-slate-400" />
            </button>
          </div>

          <nav className="space-y-4 flex-1">
            <button 
              onClick={() => { setActiveSheet('upload'); setIsSidebarOpen(false); }}
              className={cn(
                "w-full flex items-center gap-4 p-5 rounded-2xl transition-all group",
                activeSheet === 'upload' 
                  ? "bg-blue-700 text-white shadow-lg shadow-blue-200" 
                  : "hover:bg-blue-50 text-slate-600"
              )}
            >
              <div className={cn(
                "p-2.5 rounded-xl transition-colors",
                activeSheet === 'upload' ? "bg-blue-600" : "bg-slate-100 group-hover:bg-blue-100"
              )}>
                <Upload className={activeSheet === 'upload' ? "text-white" : "text-blue-600"} size={20} />
              </div>
              <div className="text-left">
                <p className="font-black uppercase text-[11px] tracking-widest">Sheet 1</p>
                <p className="font-bold text-sm">Upload dữ liệu biên bản</p>
              </div>
            </button>

            <button 
              onClick={() => { setActiveSheet('summary'); setIsSidebarOpen(false); }}
              className={cn(
                "w-full flex items-center gap-4 p-5 rounded-2xl transition-all group",
                activeSheet === 'summary' 
                  ? "bg-blue-700 text-white shadow-lg shadow-blue-200" 
                  : "hover:bg-blue-50 text-slate-600"
              )}
            >
              <div className={cn(
                "p-2.5 rounded-xl transition-colors",
                activeSheet === 'summary' ? "bg-blue-600" : "bg-slate-100 group-hover:bg-blue-100"
              )}>
                <Database className={activeSheet === 'summary' ? "text-white" : "text-blue-600"} size={20} />
              </div>
              <div className="text-left">
                <p className="font-black uppercase text-[11px] tracking-widest">Sheet 2</p>
                <p className="font-bold text-sm">Tổng hợp dữ liệu</p>
              </div>
            </button>
          </nav>

          <div className="pt-8 border-t border-slate-100">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Version 2.0 • Professional Edition</p>
          </div>
        </div>
      </aside>

      {/* Header */}
      <header className="bg-blue-800 border-b border-blue-900 px-8 py-5 flex items-center justify-between sticky top-0 z-30 shadow-lg">
        <div 
          className="flex items-center gap-6 cursor-pointer group"
          onMouseEnter={() => setIsSidebarOpen(true)}
          onClick={() => setIsSidebarOpen(true)}
        >
          <div className="w-24 h-24 rounded-2xl overflow-hidden flex items-center justify-center shadow-2xl group-hover:scale-105 transition-transform border-4 border-white/10">
            {customLogo ? (
              <img src={customLogo} alt="Logo" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div className="bg-orange-500 w-full h-full flex items-center justify-center shadow-inner">
                <ArrowDownToLine className="text-white w-10 h-10" />
              </div>
            )}
          </div>
          <div>
            <h1 className="text-3xl font-black tracking-tight text-white uppercase leading-none">SGC - CKN</h1>
            <p className="text-xs text-blue-200 font-bold uppercase tracking-widest mt-2">
              HỆ THỐNG THỐNG KÊ VÀ<br />PHÂN TÍCH THI CÔNG CỌC KHOAN NHỒI
            </p>
          </div>
          <div className="ml-4 p-2 bg-blue-700/50 rounded-lg text-blue-200 opacity-0 group-hover:opacity-100 transition-opacity">
            <Menu size={20} />
          </div>
        </div>
        
        <div className="flex items-center gap-4">
          {activeSheet === 'upload' && (
            <button 
              onClick={() => fileInputRef.current?.click()}
              className="bg-orange-500 text-white px-8 py-3 rounded-xl text-sm font-black hover:bg-orange-600 transition-all flex items-center gap-3 shadow-[0_4px_0_rgb(194,65,12)] active:translate-y-1 active:shadow-none uppercase tracking-widest"
            >
              <Upload size={20} />
              Quét biên bản
            </button>
          )}
          <button 
            onClick={() => setIsSettingsOpen(true)}
            className="p-3 bg-blue-700/50 text-blue-200 rounded-xl hover:bg-blue-600 hover:text-white transition-all shadow-inner"
            title="Cài đặt API Key"
          >
            <Settings size={20} />
          </button>
          <input type="file" ref={fileInputRef} className="hidden" accept="image/*,.pdf" multiple onChange={handleFileUpload} />
        </div>
      </header>

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
                    <div key={file.id} className="bg-white rounded-[32px] p-6 shadow-xl border border-slate-100 relative overflow-hidden group hover:shadow-2xl transition-all">
                      <div className="flex items-start justify-between mb-4">
                        <div className={cn(
                          "p-3 rounded-2xl",
                          file.status === 'completed' ? "bg-emerald-50 text-emerald-600" : 
                          file.status === 'error' ? "bg-red-50 text-red-600" : "bg-blue-50 text-blue-600"
                        )}>
                          {file.status === 'completed' ? <CheckCircle2 size={24} /> : 
                           file.status === 'error' ? <AlertCircle size={24} /> : <FileText size={24} />}
                        </div>
                        <button 
                          onClick={() => removeProcessingFile(file.id)}
                          className="p-2 text-slate-300 hover:text-red-500 transition-colors"
                        >
                          <Trash2 size={18} />
                        </button>
                      </div>
                      <div className="space-y-3">
                        <h4 className="font-bold text-slate-800 truncate pr-4 text-sm" title={file.fileName}>{file.fileName}</h4>
                        <div className="flex items-center justify-between text-[10px] font-black uppercase tracking-widest">
                          <span className={cn(
                            file.status === 'completed' ? "text-emerald-600" : 
                            file.status === 'error' ? "text-red-600" : "text-blue-600"
                          )}>
                            {file.status === 'pending' ? 'Đang chờ...' : 
                             file.status === 'processing' ? 'Đang phân tích...' : 
                             file.status === 'completed' ? 'Hoàn thành' : 'Lỗi xử lý'}
                          </span>
                          <span className="text-slate-400">{file.progress}%</span>
                        </div>
                        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                          <div 
                            className={cn(
                              "h-full transition-all duration-500",
                              file.status === 'completed' ? "bg-emerald-500" : 
                              file.status === 'error' ? "bg-red-500" : "bg-blue-500"
                            )}
                            style={{ width: `${file.progress}%` }}
                          />
                        </div>
                      </div>
                      {file.status === 'completed' && file.result && (
                        <button 
                          onClick={() => setCurrentResult(file.result!)}
                          className="mt-5 w-full py-3 bg-slate-50 text-blue-600 rounded-2xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all flex items-center justify-center gap-2 border border-slate-100"
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
                <div className="flex items-center justify-between bg-blue-50 p-6 rounded-[32px] border border-blue-100">
                  <div className="flex items-center gap-4">
                    <div className="bg-blue-600 p-3 rounded-2xl text-white">
                      <FileText size={24} />
                    </div>
                    <div>
                      <h3 className="text-xl font-black text-blue-900 uppercase tracking-tight">
                        {currentResult.fileName || currentResult.pileId}
                      </h3>
                      <p className="text-xs text-blue-600 font-bold uppercase tracking-widest mt-1">
                        {pendingResults.some(r => r.id === currentResult.id) ? "Đang chờ kiểm duyệt" : "Dữ liệu trích xuất thành công"}
                      </p>
                    </div>
                  </div>
                  <button 
                    onClick={() => setCurrentResult(null)}
                    className="px-6 py-3 bg-white text-blue-600 rounded-xl text-[10px] font-black uppercase tracking-widest hover:bg-blue-600 hover:text-white transition-all border border-blue-100 shadow-sm"
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
                  <h3 className="text-xl font-black text-orange-600 uppercase tracking-tight flex items-center gap-3">
                    <AlertCircle className="w-6 h-6" />
                    Đang chờ kiểm duyệt ({pendingResults.length})
                  </h3>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                  {pendingResults.map((result) => (
                    <div 
                      key={result.id} 
                      className="bg-white rounded-3xl p-6 shadow-md border-2 border-orange-100 relative group overflow-hidden"
                    >
                      <div className="absolute top-0 right-0 w-16 h-16 bg-orange-50 rounded-bl-[32px] flex items-center justify-center text-orange-500">
                        <AlertCircle size={20} />
                      </div>
                      <h4 className="font-black text-slate-800 uppercase tracking-tight text-sm mb-1 truncate pr-8">{result.pileId}</h4>
                      <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest truncate">{result.project}</p>
                      <div className="mt-6 flex gap-2">
                        <button 
                          onClick={() => cancelResult(result.id)}
                          className="flex-1 py-2 bg-slate-50 text-slate-400 rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-red-50 hover:text-red-500 transition-all"
                        >
                          Hủy
                        </button>
                        <button 
                          onClick={() => setCurrentResult(result)}
                          className="flex-[2] py-2 bg-blue-600 text-white rounded-xl text-[9px] font-black uppercase tracking-widest hover:bg-blue-700 transition-all shadow-lg shadow-blue-100"
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
                    <h3 className="text-xl font-black text-slate-800 uppercase tracking-tight flex items-center gap-4">
                      <div className="w-2 h-8 bg-blue-700 rounded-full" />
                      DỮ LIỆU THI CÔNG
                    </h3>
                    {isOneDriveConnected ? (
                      <div className="flex items-center gap-2 px-3 py-1 bg-emerald-50 text-emerald-600 rounded-full border border-emerald-100 animate-pulse-subtle">
                        <Cloud size={12} fill="currentColor" />
                        <span className="text-[9px] font-black uppercase tracking-widest">OneDrive Connected</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 px-3 py-1 bg-slate-100 text-slate-400 rounded-full border border-slate-200">
                        <Cloud size={12} />
                        <span className="text-[9px] font-black uppercase tracking-widest">OneDrive Disconnected</span>
                      </div>
                    )}
                  </div>
                  <button 
                    onClick={() => setActiveSheet('summary')}
                    className="text-[10px] font-black text-blue-600 hover:text-blue-800 uppercase tracking-widest transition-colors"
                  >
                    Xem tất cả
                  </button>
                </div>
                
                <div className="bg-white border border-slate-200 rounded-[32px] overflow-hidden shadow-xl">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="bg-slate-50 border-b border-slate-200">
                          <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-black text-slate-500">Dự án</th>
                          <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-black text-slate-500">Hạng</th>
                          <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-black text-slate-500">Tên bộ phận</th>
                          <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-black text-slate-500">Số hiệu</th>
                          <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-black text-slate-500">Thông kính</th>
                          <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-black text-slate-500">Ngày đầu tiên công</th>
                          <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-black text-slate-500">Ngày kết thúc thi công</th>
                          <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-black text-slate-500">Xem tập tin</th>
                          <th className="px-6 py-4 text-[10px] uppercase tracking-widest font-black text-slate-500 text-right">Thao</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {history.slice(0, 10).map((item) => (
                          <tr key={item.id} className="hover:bg-blue-50/30 transition-colors group">
                            <td className="px-6 py-4 text-xs font-bold text-slate-800">{item.project}</td>
                            <td className="px-6 py-4 text-xs text-slate-600">{item.item}</td>
                            <td className="px-6 py-4 text-xs text-slate-600">{item.componentName}</td>
                            <td className="px-6 py-4 text-xs font-black text-blue-700">{item.pileId}</td>
                            <td className="px-6 py-4 text-xs text-slate-600">{item.diameter}</td>
                            <td className="px-6 py-4 text-xs text-slate-500">{item.constructionStart}</td>
                            <td className="px-6 py-4 text-xs text-slate-500">{item.constructionEnd}</td>
                            <td className="px-6 py-4">
                              {item.fileUrl ? (
                                <a 
                                  href={item.fileUrl} 
                                  target="_blank" 
                                  rel="noopener noreferrer"
                                  className="flex items-center gap-2 text-blue-600 hover:text-blue-800 font-bold text-[10px] uppercase tracking-widest"
                                >
                                  <ExternalLink size={14} />
                                  Xem tập tin
                                </a>
                              ) : (
                                <span className="text-slate-300 text-[10px] font-bold uppercase tracking-widest italic">Chưa có tệp</span>
                              )}
                            </td>
                            <td className="px-6 py-4 text-right">
                              <button 
                                onClick={() => setCurrentResult(item)}
                                className="p-2 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-600 hover:text-white transition-all shadow-sm"
                                title="Xem chi tiết"
                              >
                                <ChevronRight size={16} />
                              </button>
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
          <SummaryView history={history} onSelectResult={(res) => { setCurrentResult(res); setActiveSheet('upload'); }} />
        )}
      </main>

      {/* Settings Modal */}
      {isSettingsOpen && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-md z-[100] flex items-center justify-center p-6 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-md rounded-[40px] shadow-2xl overflow-hidden border border-slate-100">
            <div className="bg-blue-800 p-8 text-white flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="bg-blue-700 p-3 rounded-2xl">
                  <Key size={24} />
                </div>
                <div>
                  <h3 className="text-xl font-black uppercase tracking-tight">Cấu hình API Key</h3>
                  <p className="text-xs text-blue-200 font-bold uppercase tracking-widest mt-1">Gemini AI Settings</p>
                </div>
              </div>
              <button onClick={() => setIsSettingsOpen(false)} className="p-2 hover:bg-blue-700 rounded-full transition-colors">
                <X size={20} />
              </button>
            </div>
            <div className="p-8 space-y-6">
              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Logo tùy chỉnh</label>
                  <div className="flex items-center gap-4 p-4 bg-slate-50 rounded-2xl border-2 border-slate-100">
                    <div className="w-16 h-16 bg-orange-500 rounded-xl overflow-hidden flex items-center justify-center shadow-inner">
                      {customLogo ? (
                        <img src={customLogo} alt="Preview" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
                      ) : (
                        <ArrowDownToLine className="text-white w-8 h-8" />
                      )}
                    </div>
                    <div className="flex-1 space-y-2">
                      <button 
                        onClick={() => logoInputRef.current?.click()}
                        className="w-full py-2 bg-white border border-slate-200 rounded-lg text-[10px] font-black uppercase tracking-widest text-blue-600 hover:bg-blue-50 transition-colors flex items-center justify-center gap-2"
                      >
                        <ImageIcon size={14} />
                        Thay đổi Logo
                      </button>
                      {customLogo && (
                        <button 
                          onClick={resetLogo}
                          className="w-full py-2 bg-white border border-slate-200 rounded-lg text-[10px] font-black uppercase tracking-widest text-red-500 hover:bg-red-50 transition-colors flex items-center justify-center gap-2"
                        >
                          <RotateCcw size={14} />
                          Đặt lại mặc định
                        </button>
                      )}
                    </div>
                    <input type="file" ref={logoInputRef} className="hidden" accept="image/*" onChange={handleLogoUpload} />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Kết nối OneDrive</label>
                  <div className="p-4 bg-slate-50 rounded-2xl border-2 border-slate-100 flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={cn("p-2 rounded-lg", isOneDriveConnected ? "bg-blue-100 text-blue-600" : "bg-slate-200 text-slate-400")}>
                        <Cloud size={20} />
                      </div>
                      <div>
                        <p className="text-xs font-black text-slate-800 uppercase tracking-tight">
                          {isOneDriveConnected ? "Đã kết nối OneDrive" : "Chưa kết nối OneDrive"}
                        </p>
                        <p className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">
                          {isOneDriveConnected ? "Tự động lưu file vào OneDrive" : "Kết nối để lưu file tự động"}
                        </p>
                      </div>
                    </div>
                    <button 
                      onClick={connectOneDrive}
                      disabled={isConnectingOneDrive}
                      className={cn(
                        "px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all",
                        isOneDriveConnected 
                          ? "bg-emerald-50 text-emerald-600 hover:bg-emerald-100" 
                          : "bg-blue-600 text-white hover:bg-blue-700 shadow-lg shadow-blue-100"
                      )}
                    >
                      {isConnectingOneDrive ? "Đang kết nối..." : isOneDriveConnected ? "Đã kết nối" : "Kết nối ngay"}
                    </button>
                  </div>
                  <p className="text-[10px] text-slate-400 italic mt-2 px-1">
                    * File sẽ được lưu vào thư mục /SGC-CKN/ trên OneDrive của bạn.
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] ml-1">Gemini API Key</label>
                  <div className="relative">
                    <input 
                      type="password"
                      value={userApiKey}
                      onChange={(e) => setUserApiKey(e.target.value)}
                      placeholder="Nhập API Key của bạn..."
                      className="w-full bg-slate-50 border-2 border-slate-100 rounded-2xl px-6 py-4 text-slate-900 font-bold focus:border-blue-500 focus:ring-0 transition-all outline-none"
                    />
                  </div>
                  <p className="text-[10px] text-slate-400 italic mt-2 px-1">
                    * API Key sẽ được lưu an toàn trong trình duyệt của bạn.
                  </p>
                </div>
              </div>
              <button 
                onClick={() => saveApiKey(userApiKey)}
                className="w-full bg-orange-500 text-white py-4 rounded-2xl font-black uppercase tracking-widest flex items-center justify-center gap-3 shadow-lg shadow-orange-200 hover:bg-orange-600 transition-all active:scale-95"
              >
                <Save size={20} />
                Lưu cấu hình
              </button>
            </div>
          </div>
        </div>
      )}

      <footer className="bg-slate-100 border-t border-slate-200 px-8 py-8 text-center mt-auto">
        <p className="text-slate-400 text-[11px] font-black uppercase tracking-[0.4em]">
          SGC - CKN System • Construction Data Solutions
        </p>
      </footer>
    </div>
  );
}

function ResultDisplay({ result, onSave, onCancel }: { result: ExtractionResult; onSave?: (res: ExtractionResult) => void; onCancel?: (id: string) => void }) {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-12 duration-1000">
      {/* Review Actions */}
      {(onSave || onCancel) && (
        <div className="flex items-center justify-between bg-orange-50 border-2 border-orange-100 p-6 rounded-[32px] shadow-lg animate-pulse-subtle">
          <div className="flex items-center gap-4">
            <div className="bg-orange-500 p-3 rounded-2xl text-white">
              <AlertCircle size={24} />
            </div>
            <div>
              <h4 className="text-lg font-black text-orange-900 uppercase tracking-tight">Vui lòng kiểm tra dữ liệu</h4>
              <p className="text-xs text-orange-700 font-bold uppercase tracking-widest mt-1">Dữ liệu chưa được lưu vào hệ thống</p>
            </div>
          </div>
          <div className="flex gap-4">
            {onCancel && (
              <button 
                onClick={() => onCancel(result.id)}
                className="px-8 py-4 bg-white text-red-500 rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-red-50 transition-all border-2 border-red-100 shadow-sm flex items-center gap-2"
              >
                <X size={18} />
                Hủy bỏ
              </button>
            )}
            {onSave && (
              <button 
                onClick={() => onSave(result)}
                className="px-8 py-4 bg-emerald-500 text-white rounded-2xl text-[11px] font-black uppercase tracking-widest hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-200 flex items-center gap-2"
              >
                <Save size={18} />
                Lưu dữ liệu
              </button>
            )}
          </div>
        </div>
      )}

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
        <StatCard title="Số hiệu cọc" value={result.pileId} icon={<Layers className="text-blue-500" />} />
        <StatCard title="Đường kính" value={result.diameter} icon={<Activity className="text-orange-500" />} />
        <StatCard title="Bắt đầu" value={result.constructionStart} icon={<Calendar className="text-blue-500" />} />
        <StatCard title="Kết thúc" value={result.constructionEnd} icon={<Calendar className="text-orange-500" />} />
      </div>

      <div className="flex items-center justify-between">
        <h3 className="text-2xl font-black text-slate-800 uppercase tracking-tight flex items-center gap-4">
          <div className="w-2 h-8 bg-orange-500 rounded-full" />
          Dữ liệu trích xuất chi tiết
        </h3>
        <div className="flex gap-3">
          <div className="px-4 py-2 bg-blue-100 text-blue-700 rounded-xl text-xs font-black uppercase tracking-widest border border-blue-200">
            {result.layers.length} Lớp địa chất
          </div>
          <div className="px-4 py-2 bg-orange-100 text-orange-700 rounded-xl text-xs font-black uppercase tracking-widest border border-orange-200">
            Tốc độ TB: {(result.layers.reduce((acc, l) => acc + l.speedMph, 0) / result.layers.length).toFixed(2)} m/h
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-[32px] overflow-hidden shadow-2xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse min-w-[2000px]">
            <thead>
              <tr className="bg-slate-100 border-b-2 border-slate-200">
                <th className="px-6 py-6 text-[11px] uppercase tracking-widest font-black text-slate-500 border-r border-slate-200 sticky left-0 bg-slate-100 z-10">Dự án</th>
                <th className="px-6 py-6 text-[11px] uppercase tracking-widest font-black text-slate-500 border-r border-slate-200">Hạng mục</th>
                <th className="px-6 py-6 text-[11px] uppercase tracking-widest font-black text-slate-500 border-r border-slate-200">Tên bộ phận</th>
                <th className="px-6 py-6 text-[11px] uppercase tracking-widest font-black text-slate-500 border-r border-slate-200">Số hiệu cọc</th>
                <th className="px-6 py-6 text-[11px] uppercase tracking-widest font-black text-slate-500 border-r border-slate-200">Đường kính</th>
                <th className="px-6 py-6 text-[11px] uppercase tracking-widest font-black text-slate-500 border-r border-slate-200">Bắt đầu thi công</th>
                <th className="px-6 py-6 text-[11px] uppercase tracking-widest font-black text-slate-500 border-r border-slate-200">Kết thúc thi công</th>
                <th className="px-6 py-6 text-[11px] uppercase tracking-widest font-black text-slate-500 border-r border-slate-200">Lớp thiết kế</th>
                <th className="px-6 py-6 text-[11px] uppercase tracking-widest font-black text-slate-500 border-r border-slate-200">Bắt đầu khoan</th>
                <th className="px-6 py-6 text-[11px] uppercase tracking-widest font-black text-slate-500 border-r border-slate-200">Kết thúc khoan</th>
                <th className="px-6 py-6 text-[11px] uppercase tracking-widest font-black text-slate-500 border-r border-slate-200">Thời gian khoan (h)</th>
                <th className="px-6 py-6 text-[11px] uppercase tracking-widest font-black text-slate-500 border-r border-slate-200">Cao độ bắt đầu</th>
                <th className="px-6 py-6 text-[11px] uppercase tracking-widest font-black text-slate-500 border-r border-slate-200">Cao độ kết thúc</th>
                <th className="px-6 py-6 text-[11px] uppercase tracking-widest font-black text-slate-500 border-r border-slate-200">Chiều dài (m)</th>
                <th className="px-6 py-6 text-[11px] uppercase tracking-widest font-black text-slate-500">Tốc độ (m/h)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {result.layers.map((layer, idx) => (
                <tr key={idx} className="hover:bg-blue-50/50 transition-colors group">
                  <td className="px-6 py-5 text-xs font-bold text-slate-600 border-r border-slate-100 sticky left-0 bg-white group-hover:bg-blue-50/50 z-10">{layer.project}</td>
                  <td className="px-6 py-5 text-xs font-bold text-slate-600 border-r border-slate-100">{layer.item}</td>
                  <td className="px-6 py-5 text-xs font-bold text-slate-900 border-r border-slate-100">{layer.componentName}</td>
                  <td className="px-6 py-5 text-xs font-black text-blue-700 border-r border-slate-100">{layer.pileId}</td>
                  <td className="px-6 py-5 text-xs font-bold text-slate-600 border-r border-slate-100">{layer.diameter}</td>
                  <td className="px-6 py-5 text-xs font-medium text-slate-500 border-r border-slate-100">{layer.constructionStart}</td>
                  <td className="px-6 py-5 text-xs font-medium text-slate-500 border-r border-slate-100">{layer.constructionEnd}</td>
                  <td className="px-6 py-5 text-xs font-bold text-slate-900 border-r border-slate-100 min-w-[300px] leading-relaxed italic">{layer.layerDesign}</td>
                  <td className="px-6 py-5 text-xs font-black text-slate-900 border-r border-slate-100">{layer.timeFrom}</td>
                  <td className="px-6 py-5 text-xs font-black text-slate-900 border-r border-slate-100">{layer.timeTo}</td>
                  <td className="px-6 py-5 text-xs font-black text-blue-800 border-r border-slate-100 text-center bg-blue-50/30">
                    {layer.durationHours.toFixed(2)}
                  </td>
                  <td className="px-6 py-5 text-xs font-bold text-slate-600 border-r border-slate-100 text-center">{layer.elevationFrom}</td>
                  <td className="px-6 py-5 text-xs font-bold text-slate-600 border-r border-slate-100 text-center">{layer.elevationTo}</td>
                  <td className="px-6 py-5 text-xs font-black text-slate-900 border-r border-slate-100 text-center">
                    {layer.lengthMeters.toFixed(2)}
                  </td>
                  <td className="px-6 py-5 text-center">
                    <span className={cn(
                      "inline-flex items-center px-4 py-1.5 rounded-xl text-[10px] font-black uppercase tracking-widest",
                      layer.speedMph > 5 ? "bg-emerald-100 text-emerald-700 border border-emerald-200" : "bg-orange-100 text-orange-700 border border-orange-200"
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
        <div className="bg-blue-900 rounded-[40px] p-10 shadow-2xl md:col-span-2 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-64 h-64 bg-blue-800 rounded-full -mr-32 -mt-32 opacity-20" />
          <h4 className="text-orange-400 font-black uppercase tracking-[0.3em] text-xs mb-6 flex items-center gap-3">
            <Activity size={16} />
            Phân tích năng suất địa chất
          </h4>
          <p className="text-blue-50 text-lg leading-relaxed font-medium italic relative z-10">
            "{result.summary}"
          </p>
        </div>
        <div className="bg-white border-2 border-blue-50 rounded-[40px] p-10 shadow-xl flex flex-col justify-center items-center text-center">
          <h4 className="text-slate-400 font-black uppercase tracking-widest text-xs mb-4">Tốc độ khoan trung bình</h4>
          <div className="flex items-baseline gap-3">
            <span className="text-7xl font-black text-blue-800 tracking-tighter">
              {(result.layers.reduce((acc, l) => acc + l.speedMph, 0) / result.layers.length).toFixed(2)}
            </span>
            <span className="text-orange-500 font-black uppercase tracking-widest text-sm">m/h</span>
          </div>
          <div className="mt-6 w-full h-2 bg-slate-100 rounded-full overflow-hidden">
            <div className="h-full bg-orange-500 rounded-full" style={{ width: '70%' }} />
          </div>
        </div>
      </div>
    </div>
  );
}

function SummaryView({ history, onSelectResult }: { history: ExtractionResult[], onSelectResult: (res: ExtractionResult) => void }) {
  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-12 duration-1000">
      <div className="flex items-center justify-between">
        <h3 className="text-3xl font-black text-slate-800 uppercase tracking-tight flex items-center gap-4">
          <div className="w-2 h-10 bg-blue-700 rounded-full" />
          Tổng hợp dữ liệu thi công
        </h3>
        <div className="flex items-center gap-4">
          <div className="bg-white border border-slate-200 rounded-2xl px-6 py-3 shadow-sm">
            <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Tổng số cọc đã quét</p>
            <p className="text-2xl font-black text-blue-800">{history.length}</p>
          </div>
        </div>
      </div>

      {history.length === 0 ? (
        <div className="bg-white border-2 border-dashed border-slate-200 rounded-[40px] py-32 flex flex-col items-center justify-center text-center">
          <div className="bg-slate-50 p-6 rounded-full mb-6">
            <History className="text-slate-300 w-12 h-12" />
          </div>
          <h4 className="text-xl font-bold text-slate-400 uppercase tracking-widest">Chưa có dữ liệu lịch sử</h4>
          <p className="text-slate-400 mt-2">Hãy bắt đầu bằng cách quét biên bản đầu tiên</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6">
          <div className="bg-white border border-slate-200 rounded-[32px] overflow-hidden shadow-xl">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-8 py-6 text-[11px] uppercase tracking-widest font-black text-slate-500">Dự án</th>
                    <th className="px-8 py-6 text-[11px] uppercase tracking-widest font-black text-slate-500">Hạng mục</th>
                    <th className="px-8 py-6 text-[11px] uppercase tracking-widest font-black text-slate-500">Tên bộ phận</th>
                    <th className="px-8 py-6 text-[11px] uppercase tracking-widest font-black text-slate-500">Số hiệu cọc</th>
                    <th className="px-8 py-6 text-[11px] uppercase tracking-widest font-black text-slate-500">Đường kính</th>
                    <th className="px-8 py-6 text-[11px] uppercase tracking-widest font-black text-slate-500">Ngày bắt đầu thi công</th>
                    <th className="px-8 py-6 text-[11px] uppercase tracking-widest font-black text-slate-500">Ngày kết thúc thi công</th>
                    <th className="px-8 py-6 text-[11px] uppercase tracking-widest font-black text-slate-500">Xem tập tin</th>
                    <th className="px-8 py-6 text-[11px] uppercase tracking-widest font-black text-slate-500 text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {history.map((item) => (
                    <tr key={item.id} className="hover:bg-blue-50/30 transition-colors group">
                      <td className="px-8 py-6 text-sm font-bold text-slate-800">{item.project}</td>
                      <td className="px-8 py-6 text-sm text-slate-600">{item.item}</td>
                      <td className="px-8 py-6 text-sm text-slate-600">{item.componentName}</td>
                      <td className="px-8 py-6 text-sm font-black text-blue-700">{item.pileId}</td>
                      <td className="px-8 py-6 text-sm font-bold text-slate-600">{item.diameter}</td>
                      <td className="px-8 py-6 text-sm text-slate-500">{item.constructionStart}</td>
                      <td className="px-8 py-6 text-sm text-slate-500">{item.constructionEnd}</td>
                      <td className="px-8 py-6">
                        {item.fileUrl ? (
                          <a 
                            href={item.fileUrl} 
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="flex items-center gap-2 text-blue-600 hover:text-blue-800 font-bold text-xs uppercase tracking-widest"
                          >
                            <ExternalLink size={16} />
                            Xem tập tin
                          </a>
                        ) : (
                          <span className="text-slate-300 text-xs font-bold uppercase tracking-widest italic">Chưa có tệp</span>
                        )}
                      </td>
                      <td className="px-8 py-6 text-right">
                        <button 
                          onClick={() => onSelectResult(item)}
                          className="p-2.5 bg-blue-50 text-blue-600 rounded-xl hover:bg-blue-600 hover:text-white transition-all shadow-sm"
                          title="Xem chi tiết"
                        >
                          <ChevronRight size={20} />
                        </button>
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
    <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm hover:shadow-md transition-all border-b-4 border-b-blue-100">
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2 bg-slate-50 rounded-lg">{icon}</div>
        <span className="text-[10px] font-black uppercase tracking-widest text-slate-400">{title}</span>
      </div>
      <div className="text-xl font-black text-slate-800 truncate" title={value}>
        {value || "---"}
      </div>
    </div>
  );
}
