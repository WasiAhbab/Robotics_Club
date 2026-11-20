import { getSupabase } from './supabase/client';

export async function rows<T>(
  view: string,
  order = 'id',
  limit?: number,
  memberId?: string,
): Promise<T[]> {
  const db = getSupabase();
  if (!db) throw new Error('Supabase is unavailable.');
  const result: T[] = [];
  const size = limit || 200;
  for (let start = 0; ; start += size) {
    let query = db
      .from('workspace_' + view)
      .select('*')
      .order(order, { ascending: order === 'id' });
    if (memberId) query = query.eq('memberId', memberId);
    if (order !== 'id' && order !== 'key' && order !== 'open')
      query = query.order('id');
    const { data, error } = await query.range(start, start + size - 1);
    if (error) throw new Error(error.message);
    result.push(...(data as T[]));
    if (limit || data.length < size) return result;
  }
}
export async function uploadEquipmentImage(file: File): Promise<string> {
  if (
    !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) ||
    file.size > 3 * 1024 * 1024
  )
    throw new Error('Choose a PNG, JPEG or WebP up to 3 MB.');
  const response = await fetch('/api/images', {
    method: 'POST',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!response.ok)
    throw new Error('Image upload failed. Check the file and try again.');
  return (await response.json()).path;
}
