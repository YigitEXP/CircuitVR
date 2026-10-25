import { UploadItem } from '../services/api';

const HDL = /\.(sv|v|svh|vh|vhd|vhdl)$/i;
const SKIP = new Set(['node_modules', '.git', '.circuitvr', '__pycache__', 'obj_dir']);

/** Klasör/dosya sürükle-bırak olayından HDL dosyalarını (göreli yollarıyla) toplar. */
export async function collectFromDrop(dt: DataTransfer): Promise<{ items: UploadItem[]; name: string }> {
  const out: UploadItem[] = [];
  let name = '';

  const readAll = (reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> =>
    new Promise((resolve, reject) => {
      const all: FileSystemEntry[] = [];
      const next = () =>
        reader.readEntries((batch) => {
          if (batch.length === 0) resolve(all);
          else { all.push(...batch); next(); }
        }, reject);
      next();
    });

  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      if (!HDL.test(entry.name)) return;
      const file = await new Promise<File>((res, rej) => (entry as FileSystemFileEntry).file(res, rej));
      out.push({ file, path: prefix + entry.name });
    } else if (entry.isDirectory && !SKIP.has(entry.name)) {
      const children = await readAll((entry as FileSystemDirectoryEntry).createReader());
      for (const c of children) await walk(c, prefix + entry.name + '/');
    }
  };

  const entries: FileSystemEntry[] = [];
  for (const it of Array.from(dt.items)) {
    const e = it.webkitGetAsEntry?.();
    if (e) entries.push(e);
  }
  for (const e of entries) {
    if (e.isDirectory && entries.length === 1) {
      name = e.name;
      const children = await readAll((e as FileSystemDirectoryEntry).createReader());
      for (const c of children) await walk(c, '');     // üst klasör adı yoldan çıkarılır
    } else {
      await walk(e, '');
    }
  }
  return { items: out, name };
}

/** <input webkitdirectory> veya çoklu dosya seçiminden. */
export function collectFromInput(files: FileList): { items: UploadItem[]; name: string } {
  const list = Array.from(files).filter((f) => HDL.test(f.name));
  let name = '';
  const items = list.map((file) => {
    const rel = (file as any).webkitRelativePath as string | undefined;
    if (rel && rel.includes('/')) {
      const parts = rel.split('/');
      name = parts[0];
      if (parts.some((p) => SKIP.has(p))) return null;
      return { file, path: parts.slice(1).join('/') };
    }
    return { file, path: file.name };
  }).filter(Boolean) as UploadItem[];
  return { items, name };
}
