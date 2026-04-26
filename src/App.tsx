import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Calendar, MapPin, Clock, Search, CheckCircle2, User, Users, GraduationCap, X, ChevronRight, Upload, Trash2, AlertCircle, QrCode, LogIn, RefreshCcw, Download } from 'lucide-react';
import { db, OperationType, handleFirestoreError } from '@/src/lib/firebase';
import { collection, query, where, getDocs, addDoc, onSnapshot, serverTimestamp, orderBy, writeBatch, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import * as XLSX from 'xlsx';
import { QRCodeCanvas } from 'qrcode.react';
import { Html5QrcodeScanner } from 'html5-qrcode';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';

interface Student {
  id: string;
  nama: string;
  kelas: string;
  alamat: string;
}

interface RSVP {
  id?: string;
  nama: string;
  kelas: string;
  alamat: string;
  status: string;
  pendamping: number;
  timestamp: any;
  checkedIn?: boolean;
  checkedInAt?: any;
}

export default function App() {
  const [isOpen, setIsOpen] = useState(false);
  const [timeLeft, setTimeLeft] = useState({ days: 0, hours: 0, minutes: 0, seconds: 0 });
  const [studentSearch, setStudentSearch] = useState('');
  const [suggestions, setSuggestions] = useState<Student[]>([]);
  const [selectedStudent, setSelectedStudent] = useState<Student | null>(null);
  const [status, setStatus] = useState('Hadir');
  const [pendamping, setPendamping] = useState(0);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showToast, setShowToast] = useState(false);
  const [successRSVP, setSuccessRSVP] = useState<RSVP | null>(null);
  const [duplicateRSVP, setDuplicateRSVP] = useState<string | null>(null);
  const [showAdmin, setShowAdmin] = useState(false);
  const [adminTab, setAdminTab] = useState<'rsvp' | 'siswa' | 'checkin'>('rsvp');
  const [checkInMode, setCheckInMode] = useState<'manual' | 'scan'>('manual');
  const [checkInStatus, setCheckInStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [adminStats, setAdminStats] = useState({ total: 0, hadir: 0, tidakHadir: 0, checkedIn: 0 });
  const [adminSiswa, setAdminSiswa] = useState<Student[]>([]);
  const [adminData, setAdminData] = useState<RSVP[]>([]);
  const [checkInSearch, setCheckInSearch] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);
  const [adminClickCount, setAdminClickCount] = useState(0);

  const adminKeyBuffer = useRef<string[]>([]);
  const barcodeRef = useRef<HTMLDivElement>(null);
  // Menggunakan Mei karena April sudah terlewat di sistem
  const targetTime = new Date(2026, 4, 2, 8, 0, 0).getTime(); 

  // Handle "admin123" capture
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      adminKeyBuffer.current.push(e.key);
      if (adminKeyBuffer.current.length > 8) adminKeyBuffer.current.shift();
      if (adminKeyBuffer.current.join('').includes('admin123')) {
        setShowAdmin(true);
        adminKeyBuffer.current = [];
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Countdown timer
  useEffect(() => {
    const updateCountdown = () => {
      const now = new Date().getTime();
      const distance = targetTime - now;

      if (distance < 0) {
        setTimeLeft({ days: 0, hours: 0, minutes: 0, seconds: 0 });
        return;
      }

      setTimeLeft({
        days: Math.floor(distance / (1000 * 60 * 60 * 24)),
        hours: Math.floor((distance % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60)),
        minutes: Math.floor((distance % (1000 * 60 * 60)) / (1000 * 60)),
        seconds: Math.floor((distance % (1000 * 60)) / 1000),
      });
    };

    updateCountdown(); // Jalankan langsung sekali
    const timer = setInterval(updateCountdown, 1000);

    return () => clearInterval(timer);
  }, [targetTime]); // Tambahkan targetTime ke dependency agar aman

  // Student search logic (Case-insensitive)
  useEffect(() => {
    const searchStudents = async () => {
      const searchTerm = studentSearch.toLowerCase().trim();
      if (searchTerm.length < 3) {
        setSuggestions([]);
        return;
      }

      try {
        const q = query(
          collection(db, 'siswa'),
          where('nama_search', '>=', searchTerm),
          where('nama_search', '<=', searchTerm + '\uf8ff')
        );
        const querySnapshot = await getDocs(q);
        const results: Student[] = [];
        querySnapshot.forEach((doc) => {
          results.push({ id: doc.id, ...doc.data() } as Student);
        });
        setSuggestions(results.slice(0, 5));
      } catch (error) {
        console.error('Search error:', error);
      }
    };

    const debounce = setTimeout(searchStudents, 300);
    return () => clearTimeout(debounce);
  }, [studentSearch]);

  // Admin realtime data
  useEffect(() => {
    if (!showAdmin) return;

    const q = query(collection(db, 'konfirmasi'), orderBy('timestamp', 'desc'));
    const unsubscribeRSVP = onSnapshot(q, (snapshot) => {
      const data: RSVP[] = [];
      let totalHadir = 0;
      let totalTidakHadir = 0;
      let totalCheckedIn = 0;

      snapshot.forEach((doc) => {
        const d = doc.data() as RSVP;
        data.push({ id: doc.id, ...d });
        if (d.status === 'Hadir') totalHadir++;
        else totalTidakHadir++;
        if (d.checkedIn) totalCheckedIn++;
      });

      setAdminData(data);
      setAdminStats({ total: data.length, hadir: totalHadir, tidakHadir: totalTidakHadir, checkedIn: totalCheckedIn });
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'konfirmasi');
    });

    const qSiswa = query(collection(db, 'siswa'), orderBy('nama', 'asc'));
    const unsubscribeSiswa = onSnapshot(qSiswa, (snapshot) => {
      const data: Student[] = [];
      snapshot.forEach((doc) => {
        data.push({ id: doc.id, ...doc.data() } as Student);
      });
      setAdminSiswa(data);
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'siswa');
    });

    return () => {
      unsubscribeRSVP();
      unsubscribeSiswa();
    };
  }, [showAdmin]);

  const handleRSVPSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedStudent) return;
    setIsSubmitting(true);
    setDuplicateRSVP(null);

    try {
      // Check for duplicate
      const q = query(collection(db, 'konfirmasi'), where('nama', '==', selectedStudent.nama));
      const existing = await getDocs(q);
      
      if (!existing.empty) {
        setDuplicateRSVP(selectedStudent.nama);
        setIsSubmitting(false);
        return;
      }

      const rsvpData = {
        nama: selectedStudent.nama,
        kelas: selectedStudent.kelas,
        alamat: selectedStudent.alamat,
        status,
        pendamping: status === 'Hadir' ? pendamping : 0,
        timestamp: serverTimestamp(),
        checkedIn: false
      };

      const docRef = await addDoc(collection(db, 'konfirmasi'), rsvpData);
      
      setSuccessRSVP({ id: docRef.id, ...rsvpData });
      setShowToast(true);
      setTimeout(() => setShowToast(false), 3000);
      setSelectedStudent(null);
      setStudentSearch('');
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, 'konfirmasi');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCheckIn = React.useCallback(async (rsvpId: string) => {
    try {
      const docRef = doc(db, 'konfirmasi', rsvpId);
      await updateDoc(docRef, {
        checkedIn: true,
        checkedInAt: serverTimestamp()
      });
      setCheckInStatus({ type: 'success', message: 'Check-in Berhasil!' });
      setTimeout(() => setCheckInStatus(null), 3000);
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, 'konfirmasi');
      setCheckInStatus({ type: 'error', message: 'Gagal Check-in.' });
      setTimeout(() => setCheckInStatus(null), 3000);
    }
  }, []);

  const QRScanner = ({ onScan }: { onScan: (id: string) => void }) => {
    const [scannerError, setScannerError] = useState<string | null>(null);
    const [isStarted, setIsStarted] = useState(false);

    useEffect(() => {
      let scanner: Html5QrcodeScanner | null = null;
      
      const startScanner = async () => {
        try {
          // Explicitly check for camera permission first to provide better error message
          await navigator.mediaDevices.getUserMedia({ video: true });
          
          scanner = new Html5QrcodeScanner(
            "qr-reader",
            { 
              fps: 10, 
              qrbox: { width: 250, height: 250 },
              aspectRatio: 1.0,
              showTorchButtonIfSupported: true
            },
            /* verbose= */ false
          );

          scanner.render((decodedText) => {
            onScan(decodedText);
          }, (error) => {
            // scan failure is constant searching, ignore
          });
          
          setIsStarted(true);
        } catch (err: any) {
          console.error("Camera permission error:", err);
          setScannerError(err.message || 'Izin kamera ditolak atau kamera tidak ditemukan.');
        }
      };

      // Small timeout to ensure DOM is ready
      const timeout = setTimeout(startScanner, 500);

      return () => {
        clearTimeout(timeout);
        if (scanner) {
          scanner.clear().catch(error => console.error("Failed to clear scanner", error));
        }
      };
    }, [onScan]);

    return (
      <div className="relative">
        <div id="qr-reader" className="w-full max-w-sm mx-auto overflow-hidden rounded-2xl border-4 border-zinc-100 bg-black min-h-[300px]" />
        {!isStarted && !scannerError && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-900/10 rounded-2xl p-6 text-center">
             <RefreshCcw className="w-8 h-8 text-emerald-600 animate-spin mb-4" />
             <p className="text-sm font-bold text-zinc-600">Menyiapkan Kamera...</p>
          </div>
        )}
        {scannerError && (
          <div className="absolute inset-0 flex items-center justify-center bg-zinc-900/90 rounded-2xl p-6 text-center z-50">
             <div className="text-white">
                <AlertCircle className="w-12 h-12 mx-auto mb-4 text-rose-500" />
                <p className="font-bold mb-2">Kamera Tidak Diakses</p>
                <p className="text-xs opacity-70 mb-4">{scannerError}</p>
                <button 
                  onClick={() => window.location.reload()}
                  className="px-6 py-2 bg-white text-zinc-900 rounded-xl font-bold text-sm"
                >
                  Coba Lagi (Reload)
                </button>
             </div>
          </div>
        )}
      </div>
    );
  };

  const handleResetRSVP = async () => {
    if (!window.confirm('Apakah Anda yakin ingin menghapus SEMUA data konfirmasi RSVP?')) return;
    
    setIsResetting(true);
    try {
      console.log('Starting reset process for collection: konfirmasi');
      const rsvpRef = collection(db, 'konfirmasi');
      const snapshot = await getDocs(rsvpRef);
      console.log(`Found ${snapshot.size} documents in konfirmasi to delete`);
      
      if (snapshot.size === 0) {
        alert('Tidak ada data RSVP yang bisa direset.');
        return;
      }

      const batch = writeBatch(db);
      let totalDeleted = 0;

      snapshot.docs.forEach((doc) => {
        batch.delete(doc.ref);
        totalDeleted++;
      });
      
      await batch.commit();
      console.log(`Successfully committed deletion of ${totalDeleted} documents`);
      
      alert(`Data RSVP berhasil direset. Total ${totalDeleted} data dihapus.`);
    } catch (error) {
      console.error('Detailed Reset error:', error);
      try {
        handleFirestoreError(error, OperationType.DELETE, 'konfirmasi');
      } catch (e) {
        alert(`Gagal mereset data: ${error instanceof Error ? error.message : 'Unknown error'}`);
      }
    } finally {
      setIsResetting(false);
    }
  };

  const handleDownloadBarcodePDF = async () => {
    if (!barcodeRef.current || !successRSVP) return;
    
    try {
      const canvas = await html2canvas(barcodeRef.current, {
        scale: 3,
        backgroundColor: '#ffffff',
        logging: false,
        useCORS: true
      });
      
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'mm',
        format: [100, 150] 
      });
      
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`Barcode_${successRSVP.nama.replace(/\s+/g, '_')}.pdf`);
    } catch (error) {
      console.error('PDF export error:', error);
      alert('Gagal mengekspor PDF.');
    }
  };

  const handleFooterClick = () => {
    setAdminClickCount(prev => {
      const next = prev + 1;
      if (next >= 5) {
        setShowAdmin(true);
        return 0;
      }
      return next;
    });
    // Reset counter after 2 seconds of inactivity
    setTimeout(() => setAdminClickCount(0), 2000);
  };

  const downloadTemplate = () => {
    const ws = XLSX.utils.json_to_sheet([
      { nama: 'Ahmad Fauzi', kelas: 'IX A', alamat: 'Sukarame' },
      { nama: 'Siti Aisyah', kelas: 'IX B', alamat: 'Tasikmalaya' }
    ]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Template Siswa');
    XLSX.writeFile(wb, 'template_siswa_pengukuhan.xlsx');
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadStatus(null);

    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        const bstr = event.target?.result;
        const wb = XLSX.read(bstr, { type: 'binary' });
        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const rawData = XLSX.utils.sheet_to_json(ws) as any[];

        if (rawData.length === 0) throw new Error('File Excel kosong.');

        // Normalize keys to lowercase for flexible matching (handles Nama vs nama)
        const data = rawData.map(row => {
          const newRow: any = {};
          Object.keys(row).forEach(key => {
            newRow[key.toLowerCase().trim()] = row[key];
          });
          return newRow;
        });

        const requiredFields = ['nama', 'kelas', 'alamat'];
        const firstRow = data[0];
        const hasAllFields = requiredFields.every(field => field in firstRow);
        if (!hasAllFields) throw new Error('Format salah. Pastikan kolom: nama, kelas, alamat ada di file.');

        // Step 1: Delete existing students
        const siswaRef = collection(db, 'siswa');
        const existingDocs = await getDocs(siswaRef);
        
        let batch = writeBatch(db);
        let count = 0;
        for (const d of existingDocs.docs) {
          batch.delete(d.ref);
          count++;
          if (count === 500) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }
        if (count > 0) await batch.commit();

        // Step 2: Add new students with searchable field
        batch = writeBatch(db);
        count = 0;
        for (const item of data) {
          const nama = String(item.nama || '').trim();
          const newDocRef = doc(siswaRef);
          batch.set(newDocRef, {
            nama: nama,
            nama_search: nama.toLowerCase(),
            kelas: String(item.kelas || '').trim(),
            alamat: String(item.alamat || '').trim()
          });
          count++;
          if (count === 500) {
            await batch.commit();
            batch = writeBatch(db);
            count = 0;
          }
        }
        if (count > 0) await batch.commit();

        setUploadStatus({ type: 'success', message: `Berhasil upload ${data.length} data.` });
      } catch (error: any) {
        console.error('Upload error:', error);
        setUploadStatus({ type: 'error', message: error.message || 'Gagal upload.' });
      } finally {
        setIsUploading(false);
        if (e.target) e.target.value = '';
      }
    };
    reader.readAsBinaryString(file);
  };



  if (!isOpen) {
    return (
      <div className="fixed inset-0 z-[200] flex items-center justify-center overflow-hidden">
        {/* Background Image for Welcome Screen */}
        <div 
          className="absolute inset-0 bg-cover bg-center bg-no-repeat transition-transform duration-[10s] scale-110"
          style={{ backgroundImage: 'url("https://lh3.googleusercontent.com/d/1R7bhls15OABg7rIJoOo9PrNMJbJgVCrw")' }}
        >
          <div className="absolute inset-0 bg-zinc-950/60 backdrop-blur-[2px]"></div>
          <div className="absolute inset-0 bg-gradient-to-t from-zinc-950 via-zinc-950/40 to-transparent"></div>
        </div>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="relative text-center px-6 max-w-2xl"
        >
          <div className="mb-8 flex justify-center">
            <motion.div
               initial={{ scale: 0.8, opacity: 0 }}
               animate={{ scale: 1, opacity: 1 }}
               transition={{ delay: 0.2 }}
               className="w-32 h-32 bg-white rounded-full flex items-center justify-center shadow-2xl border-4 border-emerald-500/20"
            >
               <img 
                 src="https://lh3.googleusercontent.com/d/1QO6rjDhWJAooG5U-oFuzmaQjkTlCTmeC" 
                 alt="Logo Madrasah"
                 className="w-24 h-24 object-contain"
                 referrerPolicy="no-referrer"
               />
            </motion.div>
          </div>
          <h1 className="text-3xl md:text-5xl font-bold text-white mb-4 font-display">Pengukuhan Alumni</h1>
          <p className="text-zinc-400 text-lg mb-8 leading-relaxed">
            MTs KH A Wahab Muhsin <br />
            Tahun Pelajaran 2025/2026
          </p>
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            onClick={() => setIsOpen(true)}
            className="px-8 py-4 bg-emerald-600 hover:bg-emerald-500 text-white rounded-full font-semibold transition-colors shadow-lg shadow-emerald-600/20"
          >
            Buka Undangan
          </motion.button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="min-h-screen font-sans text-zinc-900 pb-20 relative">
      {/* Global Background Image */}
      <div 
        className="fixed inset-0 z-[-1] bg-cover bg-center bg-no-repeat grayscale-[20%] opacity-15"
        style={{ backgroundImage: 'url("https://lh3.googleusercontent.com/d/1R7bhls15OABg7rIJoOo9PrNMJbJgVCrw")' }}
      >
        <div className="absolute inset-0 bg-gradient-to-br from-white/80 via-zinc-50/90 to-emerald-50/80"></div>
      </div>

      {/* Top Logo - Fixed */}
      <div className="fixed top-0 left-0 right-0 z-[100] bg-white/60 backdrop-blur-xl border-b border-white/20 px-4 py-2 flex items-center justify-between shadow-sm">
        <div className="flex items-center gap-3">
          <img 
            src="https://lh3.googleusercontent.com/d/1QO6rjDhWJAooG5U-oFuzmaQjkTlCTmeC" 
             alt="Logo Madrasah"
            className="w-10 h-10 object-contain"
            referrerPolicy="no-referrer"
          />
          <div className="flex flex-col">
            <span className="text-[10px] uppercase font-black tracking-widest text-emerald-600 leading-none mb-0.5">MTs KH A Wahab Muhsin</span>
            <span className="text-[8px] uppercase font-bold text-zinc-400 tracking-tighter leading-none">Pengukuhan Alumni 2025/2026</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {showAdmin ? (
            <button 
              onClick={() => setShowAdmin(false)}
              className="px-3 py-1 bg-zinc-900 text-white text-[10px] font-black uppercase rounded-lg hover:bg-zinc-800 transition-colors"
            >
              Keluar Admin
            </button>
          ) : (
             <div className="text-[10px] font-black uppercase text-zinc-300 tracking-widest">
                Digital Invitation
             </div>
          )}
        </div>
      </div>

      {/* Navigation Bar */}
      <nav className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[60] w-[90%] max-w-md">
        <div className="glass rounded-full px-6 py-3 flex items-center justify-between shadow-2xl border border-white/50">
          <button 
            onClick={() => document.getElementById('home')?.scrollIntoView({ behavior: 'smooth' })}
            className="flex flex-col items-center gap-1 group"
          >
            <div className="p-2 rounded-xl group-hover:bg-emerald-50 transition-colors">
              <GraduationCap className="w-5 h-5 text-zinc-400 group-hover:text-emerald-600" />
            </div>
          </button>
          <button 
            onClick={() => document.getElementById('details')?.scrollIntoView({ behavior: 'smooth' })}
            className="flex flex-col items-center gap-1 group"
          >
            <div className="p-2 rounded-xl group-hover:bg-emerald-50 transition-colors">
              <Calendar className="w-5 h-5 text-zinc-400 group-hover:text-emerald-600" />
            </div>
          </button>

          <button 
            onClick={() => document.getElementById('rsvp')?.scrollIntoView({ behavior: 'smooth' })}
            className="flex flex-col items-center gap-1 group"
          >
            <div className="p-2 rounded-xl group-hover:bg-emerald-50 transition-colors">
              <CheckCircle2 className="w-5 h-5 text-zinc-400 group-hover:text-emerald-600" />
            </div>
          </button>
        </div>
      </nav>

      {/* Hero Section */}
      <section id="home" className="relative h-screen flex items-center justify-center bg-transparent overflow-hidden">
        <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(#000 1px, transparent 0)', backgroundSize: '40px 40px' }} />
        <div className="container mx-auto px-6 text-center z-10">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true }}
              className="mb-8"
            >
              <img 
                src="https://lh3.googleusercontent.com/d/1QO6rjDhWJAooG5U-oFuzmaQjkTlCTmeC" 
                alt="Logo Madrasah Large"
                className="w-24 h-24 mx-auto object-contain drop-shadow-xl"
                referrerPolicy="no-referrer"
              />
            </motion.div>
            <span className="inline-block px-4 py-1.5 mb-6 text-sm font-semibold tracking-wider text-emerald-600 bg-white/40 backdrop-blur-sm rounded-full border border-emerald-100 uppercase">
              Digital Invitation
            </span>
            <h1 className="text-4xl md:text-6xl font-bold mb-6 font-display tracking-tight text-zinc-900">
              Pengukuhan Alumni <br />
              <span className="text-emerald-700 drop-shadow-sm">Angkatan 2025/2026</span>
            </h1>
            <p className="max-w-2xl mx-auto text-zinc-600 text-lg mb-12 font-medium">
              Assalamu'alaikum Wr. Wb. Kami mengundang Bapak/Ibu/Saudara/i Alumni MTs KH A Wahab Muhsin untuk hadir pada acara pengukuhan.
            </p>
            
            {/* Countdown */}
            <div className="grid grid-cols-4 gap-4 max-w-md mx-auto mb-12">
              {Object.entries(timeLeft).map(([label, value]) => {
                const labelsID: Record<string, string> = {
                  days: 'Hari',
                  hours: 'Jam',
                  minutes: 'Menit',
                  seconds: 'Detik'
                };
                return (
                  <div key={label} className="bg-white/60 backdrop-blur-md p-4 rounded-2xl shadow-sm border border-white/40">
                    <div className="text-2xl md:text-3xl font-bold text-zinc-900">{value}</div>
                    <div className="text-[10px] uppercase tracking-widest text-zinc-500 font-bold">{labelsID[label] || label}</div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        </div>
      </section>

      {/* Details Section */}
      <section id="details" className="py-12 bg-transparent">
        <div className="container mx-auto px-4">
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 md:gap-8">
            <motion.div 
              whileInView={{ opacity: 1, y: 0 }} 
              initial={{ opacity: 0, y: 20 }}
              viewport={{ once: true }}
              className="bg-white/60 backdrop-blur-md p-5 rounded-2xl shadow-sm border border-white/40 text-center"
            >
              <div className="w-10 h-10 bg-emerald-100/50 rounded-xl flex items-center justify-center mx-auto mb-3">
                <Calendar className="w-5 h-5 text-emerald-700" />
              </div>
              <h3 className="font-bold text-sm mb-1">Tanggal</h3>
              <p className="text-zinc-600 text-xs font-medium">Sabtu, 2 April 2026</p>
            </motion.div>

            <motion.div 
              whileInView={{ opacity: 1, y: 0 }} 
              initial={{ opacity: 0, y: 20 }}
              viewport={{ once: true }}
              transition={{ delay: 0.1 }}
              className="bg-white/60 backdrop-blur-md p-5 rounded-2xl shadow-sm border border-white/40 text-center"
            >
              <div className="w-10 h-10 bg-emerald-100/50 rounded-xl flex items-center justify-center mx-auto mb-3">
                <Clock className="w-5 h-5 text-emerald-700" />
              </div>
              <h3 className="font-bold text-sm mb-1">Waktu</h3>
              <p className="text-zinc-600 text-xs font-medium">08.00 WIB - Selesai</p>
            </motion.div>

            <motion.div 
              whileInView={{ opacity: 1, y: 0 }} 
              initial={{ opacity: 0, y: 20 }}
              viewport={{ once: true }}
              transition={{ delay: 0.2 }}
              className="bg-white/60 backdrop-blur-md p-5 rounded-2xl shadow-sm border border-white/40 text-center col-span-2 lg:col-span-1"
            >
              <div className="w-10 h-10 bg-emerald-100/50 rounded-xl flex items-center justify-center mx-auto mb-3">
                <MapPin className="w-5 h-5 text-emerald-700" />
              </div>
              <h3 className="font-bold text-sm mb-1">Lokasi</h3>
              <p className="text-zinc-600 text-xs font-medium">Aula SMK KH A Wahab Muhsin</p>
            </motion.div>
          </div>
        </div>
      </section>



      {/* RSVP Section */}
      <section id="rsvp" className="py-24 bg-emerald-950/40 backdrop-blur-3xl text-white relative overflow-hidden border-t border-white/10">
        <div className="absolute top-0 left-0 w-full h-full opacity-10 pointer-events-none">
          <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-emerald-500 blur-[100px] rounded-full" />
          <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-emerald-500 blur-[100px] rounded-full" />
        </div>

        <div className="container mx-auto px-6 max-w-xl relative z-10">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold font-display mb-4">Konfirmasi Kehadiran</h2>
            <p className="text-emerald-200/70">Silakan cari nama anak Anda pada kotak pencarian di bawah untuk melakukan konfirmasi.</p>
          </div>

          <form onSubmit={handleRSVPSubmit} className="space-y-6">
            <div className="relative">
              <label className="block text-sm font-semibold mb-2 text-emerald-100">Cari Nama (Min. 3 Huruf)</label>
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-emerald-300" />
                <input
                  type="text"
                  value={studentSearch}
                  onChange={(e) => {
                    setStudentSearch(e.target.value);
                    if (selectedStudent) setSelectedStudent(null);
                  }}
                  placeholder="Contoh: Ahmad Fauzi"
                  className="w-full pl-12 pr-4 py-4 bg-white/5 border border-white/10 rounded-2xl focus:ring-2 focus:ring-emerald-500 outline-none transition-all"
                />
              </div>

              {/* Suggestions dropdown */}
              <AnimatePresence>
                {suggestions.length > 0 && !selectedStudent && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="absolute top-full left-0 w-full mt-2 bg-zinc-900 border border-white/10 rounded-2xl overflow-hidden z-20 shadow-2xl"
                  >
                    {suggestions.map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setSelectedStudent(s);
                          setSuggestions([]);
                          setStudentSearch(s.nama);
                        }}
                        className="w-full p-4 text-left hover:bg-white/5 flex items-center justify-between border-b border-white/5 last:border-0 transition-colors"
                      >
                        <div>
                          <p className="font-semibold text-white">{s.nama}</p>
                          <p className="text-xs text-emerald-400">{s.kelas} • {s.alamat}</p>
                        </div>
                        <ChevronRight className="w-4 h-4 text-emerald-500" />
                      </button>
                    ))}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

              {duplicateRSVP && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-rose-500/20 p-6 rounded-2xl border border-rose-500/30 flex items-start gap-4"
                >
                  <AlertCircle className="w-6 h-6 text-rose-400 flex-shrink-0 mt-1" />
                  <div>
                    <p className="font-bold text-rose-200">Sudah Konfirmasi</p>
                    <p className="text-sm text-rose-100/70">Bapak/Ibu untuk orang tua dari <span className="font-black underline italic text-white uppercase tracking-tighter">{duplicateRSVP}</span> telah melakukan konfirmasi kehadiran sebelumnya.</p>
                  </div>
                  <button onClick={() => setDuplicateRSVP(null)} className="ml-auto text-white/50 hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                </motion.div>
              )}

              {selectedStudent && (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="bg-emerald-800/30 p-6 rounded-2xl border border-emerald-500/30"
              >
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 bg-emerald-500/20 rounded-full flex items-center justify-center flex-shrink-0">
                    <User className="w-5 h-5 text-emerald-400" />
                  </div>
                  <div>
                    <p className="text-sm text-emerald-300">Data Terdeteksi:</p>
                    <p className="font-bold text-lg">{selectedStudent.nama}</p>
                    <p className="text-sm opacity-70">{selectedStudent.kelas} — {selectedStudent.alamat}</p>
                  </div>
                  <button onClick={() => setSelectedStudent(null)} className="ml-auto text-white/50 hover:text-white">
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </motion.div>
            )}

            <div className="grid grid-cols-2 gap-4">
              <button
                type="button"
                onClick={() => setStatus('Hadir')}
                className={`py-4 rounded-2xl border transition-all ${
                  status === 'Hadir' 
                    ? 'bg-emerald-500 border-emerald-500 text-white shadow-lg shadow-emerald-600/30 font-bold' 
                    : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
                }`}
              >
                Hadir
              </button>
              <button
                type="button"
                onClick={() => setStatus('Tidak Hadir')}
                className={`py-4 rounded-2xl border transition-all ${
                  status === 'Tidak Hadir' 
                    ? 'bg-zinc-800 border-zinc-700 text-white font-bold' 
                    : 'bg-white/5 border-white/10 text-white/70 hover:bg-white/10'
                }`}
              >
                Tidak Hadir
              </button>
            </div>

            {status === 'Hadir' && (
              <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
                <label className="block text-sm font-semibold mb-2 text-emerald-100 text-center">Jumlah Pendamping (Maks. 2)</label>
                <div className="flex justify-center gap-3">
                  {[0, 1, 2].map((num) => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => setPendamping(num)}
                      className={`w-14 h-14 rounded-xl border transition-all flex items-center justify-center font-bold ${
                        pendamping === num 
                          ? 'bg-emerald-500 border-emerald-500 text-white' 
                          : 'bg-white/5 border-white/10 text-white/70'
                      }`}
                    >
                      {num}
                    </button>
                  ))}
                </div>
              </motion.div>
            )}

            <button
              disabled={!selectedStudent || isSubmitting}
              className="w-full py-4 bg-white text-emerald-950 rounded-2xl font-bold hover:bg-emerald-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-xl"
            >
              {isSubmitting ? 'Mengirim...' : 'Kirim Konfirmasi'}
            </button>
          </form>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 bg-white text-center border-t border-zinc-100">
        <p 
          className="text-zinc-400 text-[10px] uppercase tracking-widest font-bold cursor-default select-none"
          onClick={handleFooterClick}
        >
          &copy; 2026 • MTs KH A Wahab Muhsin <br />
          <span className="opacity-50">Digital Invitation System</span>
        </p>
      </footer>

      {/* Notifications */}
      <AnimatePresence>
        {showToast && (
          <motion.div
            initial={{ opacity: 0, y: 50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 50 }}
            className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[60]"
          >
            <div className="bg-emerald-600 text-white px-6 py-3 rounded-full shadow-2xl flex items-center gap-3">
              <CheckCircle2 className="w-5 h-5" />
              <span className="font-medium">Konfirmasi Berhasil Dikirim!</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Success QR Modal */}
      <AnimatePresence>
        {successRSVP && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] flex items-center justify-center bg-zinc-950/90 backdrop-blur-sm p-6"
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="bg-white rounded-[40px] p-8 max-w-sm w-full text-center relative overflow-hidden"
            >
              <div className="absolute top-0 left-0 w-full h-2 bg-emerald-500" />
              <button 
                onClick={() => setSuccessRSVP(null)}
                className="absolute top-6 right-6 p-2 bg-zinc-100 rounded-full hover:bg-zinc-200"
              >
                <X className="w-5 h-5 text-zinc-600" />
              </button>

              <div className="mb-6">
                <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4 border-4 border-emerald-50 text-emerald-600">
                  <CheckCircle2 className="w-10 h-10" />
                </div>
                <h3 className="text-2xl font-bold text-zinc-900 leading-tight">Konfirmasi Berhasil!</h3>
                <p className="text-zinc-500 text-sm mt-2">Terima kasih telah melakukan konfirmasi kehadiran.</p>
              </div>

              <div ref={barcodeRef} className="bg-zinc-50 p-6 rounded-3xl border-2 border-dashed border-zinc-200 mb-6 flex flex-col items-center">
                <p className="text-[10px] uppercase font-bold tracking-widest text-zinc-400 mb-4">Scan Barcode Check-in</p>
                <div className="bg-white p-4 rounded-2xl shadow-xl">
                  <QRCodeCanvas 
                    value={successRSVP.id || ''} 
                    size={160} 
                    level="H" 
                    includeMargin={false}
                  />
                </div>
                <div className="mt-4 text-center">
                   <p className="font-black text-xl uppercase tracking-tighter text-zinc-900">{successRSVP.nama}</p>
                   <p className="text-xs text-zinc-500 font-bold">{successRSVP.kelas}</p>
                </div>
              </div>

              <div className="space-y-3">
                <button 
                  onClick={handleDownloadBarcodePDF}
                  className="w-full py-4 bg-zinc-900 text-white rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-zinc-800 transition-all"
                >
                  <Download className="w-4 h-4" />
                  Simpan Barcode (PDF)
                </button>
                <button 
                  onClick={() => setSuccessRSVP(null)}
                  className="w-full py-4 bg-zinc-100 text-zinc-600 rounded-2xl font-bold hover:bg-zinc-200 transition-all"
                >
                  Selesai
                </button>
              </div>
              
              <p className="mt-6 text-[10px] text-zinc-400 font-medium italic">
                *Tunjukkan barcode ini kepada petugas saat tiba di lokasi acara.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Admin Panel Overlay */}
      <AnimatePresence>
        {showAdmin && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[150] bg-white overflow-y-auto px-6 py-12"
          >
            <div className="container mx-auto max-w-6xl">
              <div className="flex items-center justify-between mb-12">
                <div>
                  <h2 className="text-4xl font-bold font-display text-zinc-900 drop-shadow-sm">Admin Dashboard</h2>
                  <p className="text-zinc-600 font-medium">Monitoring kehadiran & RSVP Alumni 2025/2026</p>
                </div>
                <button 
                  onClick={() => setShowAdmin(false)}
                  className="p-3 bg-zinc-100 rounded-full hover:bg-zinc-200"
                >
                  <X className="text-zinc-900" />
                </button>
              </div>

              {/* Stats */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
                <div className="bg-zinc-50 p-6 rounded-3xl border border-zinc-100 shadow-sm flex flex-col justify-between">
                  <div>
                    <p className="text-zinc-500 mb-1 text-xs uppercase font-bold tracking-wider">Total Konfirmasi</p>
                    <h4 className="text-4xl font-bold text-zinc-900">{adminStats.total}</h4>
                  </div>
                  <button 
                    onClick={handleResetRSVP}
                    disabled={isResetting || adminStats.total === 0}
                    className="mt-4 flex items-center justify-center gap-2 py-2 px-4 bg-rose-600/10 text-rose-600 rounded-xl text-xs font-black uppercase tracking-tighter hover:bg-rose-600 hover:text-white transition-all border border-rose-200 disabled:opacity-50"
                  >
                    <RefreshCcw className={`w-3 h-3 ${isResetting ? 'animate-spin' : ''}`} />
                    <span>Reset Data RSVP</span>
                  </button>
                </div>
                <div className="bg-emerald-50 p-6 rounded-3xl border border-emerald-100 flex flex-col justify-center">
                  <p className="text-emerald-700 mb-1 text-xs uppercase font-bold tracking-wider">Hadir</p>
                  <h4 className="text-4xl font-bold text-emerald-900">{adminStats.hadir}</h4>
                </div>
                <div className="bg-amber-50 p-6 rounded-3xl border border-amber-100 flex flex-col justify-center">
                  <p className="text-amber-700 mb-1 text-xs uppercase font-bold tracking-wider">Telah Check-in</p>
                  <h4 className="text-4xl font-bold text-amber-900">{adminStats.checkedIn}</h4>
                </div>
                <div className="bg-indigo-50 p-6 rounded-3xl border border-indigo-100 flex flex-col justify-between">
                  <div>
                    <p className="text-indigo-700 mb-2 text-xs uppercase font-bold tracking-wider line-clamp-1">Data Siswa (Excel)</p>
                    <div className="flex gap-2">
                       <label className="flex items-center justify-center gap-2 flex-1 py-2 px-3 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-[10px] font-semibold cursor-pointer transition-colors shadow-sm">
                        {isUploading ? (
                          <div className="animate-spin rounded-full h-3 w-3 border-2 border-white border-t-transparent" />
                        ) : <Upload className="w-3 h-3" />}
                        <span>{isUploading ? 'Upload...' : 'Pilih File'}</span>
                        <input type="file" accept=".xlsx, .xls" className="hidden" onChange={handleFileUpload} disabled={isUploading} />
                      </label>
                      <button 
                        onClick={downloadTemplate}
                        className="p-2 bg-white border border-indigo-200 text-indigo-600 rounded-xl hover:bg-zinc-50 transition-colors"
                        title="Download Template"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                  {uploadStatus && (
                    <div className={`mt-2 text-[10px] flex items-center gap-1.5 font-bold ${uploadStatus.type === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>
                      {uploadStatus.type === 'success' ? <CheckCircle2 className="w-3 h-3" /> : <AlertCircle className="w-3 h-3" />}
                      <span className="line-clamp-1 text-[9px]">{uploadStatus.message}</span>
                    </div>
                  )}
                </div>
            </div>

              {/* Tabs */}
              <div className="flex gap-2 md:gap-4 mb-8 p-1 bg-zinc-100 rounded-2xl w-fit">
                <button 
                  onClick={() => setAdminTab('rsvp')}
                  className={`px-4 md:px-6 py-2 rounded-xl text-xs md:text-sm font-bold transition-all ${adminTab === 'rsvp' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600 hover:bg-zinc-200'}`}
                >
                  Konfirmasi RSVP
                </button>
                <button 
                  onClick={() => setAdminTab('checkin')}
                  className={`px-4 md:px-6 py-2 rounded-xl text-xs md:text-sm font-bold transition-all ${adminTab === 'checkin' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600 hover:bg-zinc-200'}`}
                >
                  Check-in Tamu
                </button>
                <button 
                  onClick={() => setAdminTab('siswa')}
                  className={`px-4 md:px-6 py-2 rounded-xl text-xs md:text-sm font-bold transition-all ${adminTab === 'siswa' ? 'bg-white text-zinc-900 shadow-sm' : 'text-zinc-600 hover:bg-zinc-200'}`}
                >
                  Daftar Siswa
                </button>
              </div>

              {/* Table */}
              <div className="overflow-x-auto bg-white border border-zinc-200 rounded-3xl shadow-sm">
                {adminTab === 'rsvp' ? (
                  <table className="w-full text-left">
                    <thead className="bg-zinc-50 border-b border-zinc-200 font-bold text-zinc-600">
                      <tr>
                        <th className="p-6">Nama</th>
                        <th className="p-6 text-center">Status</th>
                        <th className="p-6 text-center">Check-in</th>
                        <th className="p-6">Pendamping</th>
                        <th className="p-6">Waktu RSVP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminData.length === 0 ? (
                        <tr><td colSpan={5} className="p-12 text-center text-zinc-500 font-medium">Belum ada konfirmasi.</td></tr>
                      ) : adminData.map((row) => (
                        <tr key={row.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                          <td className="p-6 font-semibold">
                            <span className="text-zinc-900">{row.nama}</span>
                            <span className="block text-[10px] text-zinc-500 font-medium mt-0.5">{row.kelas}</span>
                          </td>
                          <td className="p-6 text-center">
                            <span className={`px-4 py-1.5 rounded-full text-[10px] font-black uppercase tracking-tighter ${
                              row.status === 'Hadir' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-rose-500/10 text-rose-700'
                            }`}>
                              {row.status}
                            </span>
                          </td>
                          <td className="p-6 text-center">
                            {row.checkedIn ? (
                              <div className="flex flex-col items-center">
                                <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                                <span className="text-[9px] text-zinc-500 font-medium mt-1">
                                  {row.checkedInAt?.toDate().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
                                </span>
                              </div>
                            ) : (
                               <span className="text-xs text-zinc-300">—</span>
                            )}
                          </td>
                          <td className="p-6">
                             <div className="flex items-center gap-2 text-sm font-medium">
                               <Users className="w-4 h-4 text-zinc-500" />
                               <span className="text-zinc-700">{row.pendamping} Orang</span>
                             </div>
                          </td>
                          <td className="p-6 text-[10px] text-zinc-500 font-medium">
                            {row.timestamp?.toDate().toLocaleString('id-ID')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : adminTab === 'checkin' ? (
                  <div className="p-8">
                     <div className="max-w-2xl mx-auto">
                        <div className="text-center mb-10">
                           <h3 className="text-3xl font-black mb-2 uppercase tracking-tighter text-zinc-900">Check-in System</h3>
                           <h4 className="text-lg font-bold text-zinc-700 uppercase tracking-tight mb-2">Pengukuhan Alumni MTs KH A Wahab Muhsin</h4>
                           <p className="text-zinc-500 font-bold mb-8">Tahun Pelajaran 2025/2026</p>
                           
                           {/* Mode Toggle */}
                           <div className="flex justify-center gap-4">
                              <button 
                                 onClick={() => setCheckInMode('manual')}
                                 className={`flex items-center gap-3 py-4 px-8 rounded-3xl font-black text-xs transition-all shadow-sm uppercase tracking-tight ${
                                    checkInMode === 'manual' 
                                    ? 'bg-zinc-900 text-white shadow-zinc-200 shadow-2xl scale-105' 
                                    : 'bg-zinc-100 text-zinc-400 hover:bg-zinc-200'
                                 }`}
                              >
                                 <Search className="w-5 h-5" />
                                 <span>Pencarian</span>
                              </button>
                              <button 
                                 onClick={() => setCheckInMode('scan')}
                                 className={`flex items-center gap-3 py-4 px-8 rounded-3xl font-black text-xs transition-all shadow-sm uppercase tracking-tight ${
                                    checkInMode === 'scan' 
                                    ? 'bg-zinc-900 text-white shadow-zinc-200 shadow-2xl scale-105' 
                                    : 'bg-zinc-100 text-zinc-400 hover:bg-zinc-200'
                                 }`}
                              >
                                 <QrCode className="w-5 h-5" />
                                 <span>Scan QR</span>
                              </button>
                           </div>
                        </div>

                        {checkInStatus && (
                           <motion.div 
                              initial={{ opacity: 0, scale: 0.9 }}
                              animate={{ opacity: 1, scale: 1 }}
                              className={`mb-8 p-6 rounded-3xl text-center font-black uppercase tracking-tighter text-lg shadow-xl ${
                                 checkInStatus.type === 'success' ? 'bg-emerald-600 text-white' : 'bg-rose-600 text-white'
                              }`}
                           >
                              {checkInStatus.message}
                           </motion.div>
                        )}

                        {checkInMode === 'scan' ? (
                           <div className="bg-zinc-50 p-8 rounded-[48px] border-4 border-dashed border-zinc-200 shadow-inner">
                              <QRScanner onScan={(id) => handleCheckIn(id)} />
                              <div className="mt-8 flex items-center justify-center gap-3 text-zinc-500 animate-pulse">
                                 <AlertCircle className="w-5 h-5" />
                                 <p className="text-[10px] font-black uppercase tracking-widest">Arahkan barcode atau QR ke kamera</p>
                              </div>
                           </div>
                        ) : (
                           <div className="text-left">
                              <div className="relative mb-10">
                                 <Search className="absolute left-6 top-1/2 -translate-y-1/2 w-6 h-6 text-zinc-300" />
                                 <input 
                                    type="text"
                                    placeholder="Cari nama anak / tamu..."
                                    value={checkInSearch}
                                    className="w-full pl-16 pr-6 py-6 bg-zinc-50 border-2 border-zinc-100 rounded-[32px] focus:bg-white focus:border-zinc-900 outline-none transition-all text-lg font-bold placeholder:text-zinc-300"
                                    onChange={(e) => setCheckInSearch(e.target.value)}
                                 />
                              </div>
                              <div className="space-y-4 max-h-[500px] overflow-y-auto pr-4 custom-scrollbar">
                                 {adminData
                                 .filter(r => r.status === 'Hadir')
                                 .filter(r => r.nama.toLowerCase().includes(checkInSearch.toLowerCase()))
                                 .map((row) => (
                                    <div key={row.id} className="flex items-center justify-between p-4 bg-zinc-50 border border-zinc-100 rounded-2xl transition-colors hover:bg-zinc-100">
                                       <div>
                                          <p className="font-bold text-zinc-900">{row.nama}</p>
                                          <p className="text-[10px] font-medium text-zinc-500 uppercase tracking-tight">{row.kelas} • {row.alamat}</p>
                                       </div>
                                       {row.checkedIn ? (
                                          <div className="flex items-center gap-2 text-emerald-600 font-bold text-sm">
                                             <CheckCircle2 className="w-5 h-5" />
                                             <span>Masuk</span>
                                          </div>
                                       ) : (
                                          <button 
                                             onClick={() => handleCheckIn(row.id!)}
                                             className="flex items-center gap-2 py-2 px-6 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold transition-all shadow-md"
                                          >
                                             <LogIn className="w-4 h-4" />
                                             <span>Check In</span>
                                          </button>
                                       )}
                                    </div>
                                 ))}
                                 {adminData.filter(r => r.status === 'Hadir').filter(r => r.nama.toLowerCase().includes(checkInSearch.toLowerCase())).length === 0 && (
                                    <div className="text-center py-24 bg-zinc-50 rounded-[48px] border-4 border-dashed border-zinc-100 font-black text-zinc-300 uppercase tracking-widest text-sm">
                                       Belum Ada Data
                                    </div>
                                 )}
                              </div>
                           </div>
                        )}
                     </div>
                  </div>
                ) : (
                  <table className="w-full text-left">
                    <thead className="bg-zinc-50 border-b border-zinc-200 font-bold text-zinc-600">
                      <tr>
                        <th className="p-6">Nama</th>
                        <th className="p-6">Kelas</th>
                        <th className="p-6">Alamat</th>
                      </tr>
                    </thead>
                    <tbody>
                      {adminSiswa.length === 0 ? (
                        <tr><td colSpan={3} className="p-12 text-center text-zinc-400">Belum ada data siswa. Silakan upload Excel.</td></tr>
                      ) : adminSiswa.map((row) => (
                        <tr key={row.id} className="border-b border-zinc-100 last:border-0 hover:bg-zinc-50">
                          <td className="p-6 font-semibold text-zinc-900">{row.nama}</td>
                          <td className="p-6 text-zinc-600 font-medium">{row.kelas}</td>
                          <td className="p-6 text-zinc-500 text-sm">{row.alamat}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
