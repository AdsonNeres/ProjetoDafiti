import React, { useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { FileUp, Download, Calendar, Save } from 'lucide-react';
import { supabase } from './lib/supabase';
import { format, subDays, parse } from 'date-fns';

interface ProcessedData {
  id?: string;
  referencia: string;
  valorMercadoria: number;
  ultimaOcorrencia: string;
  dataUltimaOcorrencia: string;
  status: string;
  statusUpdatedAt?: string;
}

function App() {
  const [data, setData] = useState<ProcessedData[]>([]);
  const [error, setError] = useState<string>('');
  const [daysToShow, setDaysToShow] = useState<number>(1);
  const [pendingStatusChanges, setPendingStatusChanges] = useState<Record<string, string>>({});

  useEffect(() => {
    loadSavedData();
  }, [daysToShow]);

  const loadSavedData = async () => {
    try {
      const startDate = format(subDays(new Date(), daysToShow), 'yyyy-MM-dd');
      
      const { data: savedData, error: dbError } = await supabase
        .from('orders')
        .select('*')
        .gte('created_at', startDate);

      if (dbError) throw dbError;
      
      if (savedData) {
        setData(savedData.map(item => ({
          id: item.id,
          referencia: item.referencia,
          valorMercadoria: item.valor_mercadoria || 0,
          ultimaOcorrencia: item.ultima_ocorrencia,
          dataUltimaOcorrencia: format(new Date(item.data_ultima_ocorrencia), 'dd/MM/yyyy HH:mm'),
          status: item.status,
          statusUpdatedAt: item.status_updated_at ? format(new Date(item.status_updated_at), 'dd/MM/yyyy HH:mm') : undefined
        })));
      }
    } catch (err) {
      console.error('Error loading data:', err);
      setError('Erro ao carregar dados salvos.');
    }
  };

  const formatDateTime = (dateStr: string | number): string => {
    try {
      if (typeof dateStr === 'number') {
        // Convert Excel serial number to date
        const date = XLSX.SSF.parse_date_code(dateStr);
        const jsDate = new Date(date.y, date.m - 1, date.d, date.H, date.M);
        
        if (isNaN(jsDate.getTime())) {
          console.error('Invalid date from Excel:', dateStr);
          return dateStr;
        }
        
        // Return ISO format for database storage
        return format(jsDate, 'yyyy-MM-dd HH:mm:ss');
      }

      // Handle string date format (dd/MM/yyyy HH:mm)
      if (typeof dateStr === 'string' && dateStr.match(/^\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}$/)) {
        const parsedDate = parse(dateStr, 'dd/MM/yyyy HH:mm', new Date());
        if (!isNaN(parsedDate.getTime())) {
          return format(parsedDate, 'yyyy-MM-dd HH:mm:ss');
        }
      }

      // Try parsing as regular date string
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        return format(date, 'yyyy-MM-dd HH:mm:ss');
      }

      console.error('Invalid date string:', dateStr);
      return dateStr;
    } catch (err) {
      console.error('Error formatting date:', err);
      return dateStr;
    }
  };

  const processExcel = async (file: File) => {
    setError('');
    const reader = new FileReader();
    
    reader.onerror = () => {
      setError('Erro ao ler o arquivo. Por favor, tente novamente.');
    };

    reader.onload = async (e) => {
      try {
        const data = e.target?.result;
        if (!data) {
          setError('Arquivo vazio ou inválido.');
          return;
        }

        const workbook = XLSX.read(data, { type: 'binary' });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        
        // Get the range of data in the sheet
        const range = XLSX.utils.decode_range(firstSheet['!ref'] || 'A1');
        
        // Convert the specific columns (D, E, F, Q) to array, starting from row 2
        const processedData: ProcessedData[] = [];
        
        for (let row = 2; row <= range.e.r + 1; row++) {
          const referenciaCell = firstSheet[`D${row}`];
          const ocorrenciaCell = firstSheet[`E${row}`];
          const dataCell = firstSheet[`F${row}`];
          const valorCell = firstSheet[`Q${row}`];
          
          if (referenciaCell && ocorrenciaCell && dataCell) {
            const referencia = String(referenciaCell.v || '').trim();
            const ultimaOcorrencia = String(ocorrenciaCell.v || '').trim();
            const dataUltimaOcorrencia = formatDateTime(dataCell.v);
            const valorMercadoria = valorCell ? Number(valorCell.v) || 0 : 0;
            
            if (referencia && 
                (ultimaOcorrencia === 'Recebido na Base' || 
                 ultimaOcorrencia === 'Coletado')) {
              processedData.push({
                referencia,
                valorMercadoria,
                ultimaOcorrencia,
                dataUltimaOcorrencia,
                status: 'Pendentes'
              });
            }
          }
        }

        if (processedData.length === 0) {
          setError('Nenhum dado encontrado com os critérios especificados.');
          return;
        }

        // Remove duplicates keeping the latest entry
        const uniqueData = processedData.reduce((acc: ProcessedData[], current) => {
          const existingIndex = acc.findIndex(item => item.referencia === current.referencia);
          if (existingIndex >= 0) {
            acc[existingIndex] = current;
          } else {
            acc.push(current);
          }
          return acc;
        }, []);

        // Save to Supabase
        const { error: dbError } = await supabase
          .from('orders')
          .insert(uniqueData.map(item => ({
            referencia: item.referencia,
            valor_mercadoria: item.valorMercadoria,
            ultima_ocorrencia: item.ultimaOcorrencia,
            data_ultima_ocorrencia: item.dataUltimaOcorrencia,
            status: item.status
          })));

        if (dbError) throw dbError;

        await loadSavedData();
      } catch (err) {
        setError('Erro ao processar o arquivo. Verifique se o formato está correto.');
        console.error('Error processing Excel file:', err);
      }
    };

    reader.readAsBinaryString(file);
  };

  const handleStatusChange = (id: string, newStatus: string) => {
    setPendingStatusChanges(prev => ({
      ...prev,
      [id]: newStatus
    }));
  };

  const saveStatus = async (id: string) => {
    try {
      const newStatus = pendingStatusChanges[id];
      if (!newStatus) return;

      const { error: dbError } = await supabase
        .from('orders')
        .update({ 
          status: newStatus,
          status_updated_at: new Date().toISOString()
        })
        .eq('id', id);

      if (dbError) throw dbError;

      // Update local state
      setData(data.map(item => 
        item.id === id ? { 
          ...item, 
          status: newStatus,
          statusUpdatedAt: format(new Date(), 'dd/MM/yyyy HH:mm')
        } : item
      ));

      // Clear pending change
      setPendingStatusChanges(prev => {
        const newPending = { ...prev };
        delete newPending[id];
        return newPending;
      });
    } catch (err) {
      console.error('Error updating status:', err);
      setError('Erro ao atualizar o status.');
    }
  };

  const exportToExcel = () => {
  try {
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Dados Processados");

    // Formata a data do dia
    const today = format(new Date(), 'dd-MM-yyyy');
    const filename = `ConsultaDafiti-${today}.xlsx`; // <-- Aqui é crase!

    XLSX.writeFile(wb, filename);
  } catch (err) {
    setError('Erro ao exportar o arquivo.');
    console.error('Error exporting to Excel:', err);
  }
};


  return (
    <div className="min-h-screen bg-gray-100 p-8">
      <h1 className="text-4xl font-bold mb-8 text-[#ed5c0e] text-center">
        Consulta Dafiti R2PP
      </h1>

      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-lg shadow-md p-6 mb-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer bg-[#ed5c0e] text-white px-4 py-2 rounded hover:bg-[#d45509] transition-colors">
                <FileUp size={20} />
                Importar XLSX
                <input
                  type="file"
                  accept=".xlsx,.xls"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && processExcel(e.target.files[0])}
                />
              </label>

              <div className="flex items-center gap-2">
                <Calendar size={20} className="text-gray-600" />
                <select
                  value={daysToShow}
                  onChange={(e) => setDaysToShow(Number(e.target.value))}
                  className="border rounded px-2 py-1"
                >
                  <option value={1}>Último dia</option>
                  <option value={7}>Últimos 7 dias</option>
                  <option value={15}>Últimos 15 dias</option>
                  <option value={30}>Últimos 30 dias</option>
                </select>
              </div>
            </div>

            {data.length > 0 && (
              <button
                onClick={exportToExcel}
                className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700 transition-colors"
              >
                <Download size={20} />
                Exportar XLSX
              </button>
            )}
          </div>

          {error && (
            <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded mb-6">
              {error}
            </div>
          )}

          {data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Referência
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Valor Mercadoria
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Última Ocorrência
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Data Última Ocorrência
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Última Atualização
                    </th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                      Ações
                    </th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {data.map((row) => (
                    <tr key={row.id}>
                      <td className="px-6 py-4 whitespace-nowrap">{row.referencia}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {row.valorMercadoria.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">{row.ultimaOcorrencia}</td>
                      <td className="px-6 py-4 whitespace-nowrap">{row.dataUltimaOcorrencia}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <select
                          value={pendingStatusChanges[row.id!] || row.status}
                          onChange={(e) => row.id && handleStatusChange(row.id, e.target.value)}
                          className="border rounded px-2 py-1"
                        >
                          <option value="Pendentes">Pendentes</option>
                          <option value="Resolvido">Resolvido</option>
                          <option value="Extraviado">Extraviado</option>
                        </select>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {row.statusUpdatedAt || '-'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {pendingStatusChanges[row.id!] && (
                          <button
                            onClick={() => row.id && saveStatus(row.id)}
                            className="flex items-center gap-1 bg-blue-500 text-white px-3 py-1 rounded hover:bg-blue-600 transition-colors"
                          >
                            <Save size={16} />
                            Salvar
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default App;