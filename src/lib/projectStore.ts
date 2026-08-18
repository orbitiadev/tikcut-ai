import type { LocalProject } from './types';
import { supabase } from './supabase';

const KEY = 'tikcut-ai-project';

export function loadLocalProject(): LocalProject | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) as LocalProject : null;
  } catch {
    return null;
  }
}

export function saveLocalProject(project: LocalProject): void {
  localStorage.setItem(KEY, JSON.stringify(project));
}

export async function syncProject(project: LocalProject): Promise<'offline' | 'synced'> {
  if (!supabase) return 'offline';
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return 'offline';
  const { error } = await supabase.from('projects').upsert({
    id: project.id,
    user_id: userData.user.id,
    name: project.name,
    transcript: project.transcript,
    trim_start: project.trimStart,
    trim_end: project.trimEnd,
    caption_style: project.captionStyle,
    updated_at: new Date().toISOString()
  });
  if (error) throw error;
  return 'synced';
}
