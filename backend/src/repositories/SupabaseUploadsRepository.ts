import type { SupabaseClient } from '@supabase/supabase-js'
import type { Upload, UploadStatus } from '../types'
import type { UploadsRepository } from './UploadsRepository'
import { ConflictError } from '../errors'

// supabase-js's query builder is loosely typed unless generated Database types
// are provided (not set up yet — see backend/README.md). This row shape mirrors
// backend/supabase/schema.sql's `uploads` table exactly.
interface UploadRow {
  id: string
  user_id: string
  original_file_name: string
  mime_type: string
  size_bytes: number
  storage_key: string
  status: string
  created_at: string
}

function mapRowToUpload(row: UploadRow): Upload {
  return {
    id: row.id,
    userId: row.user_id,
    originalFileName: row.original_file_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    storageKey: row.storage_key,
    status: row.status as UploadStatus,
    createdAt: row.created_at,
  }
}

/** Real Supabase-backed implementation — used whenever SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are configured (see createUploadsRepository). */
export class SupabaseUploadsRepository implements UploadsRepository {
  constructor(private readonly client: SupabaseClient) {}

  /** Relies on schema.sql's unique(user_id, original_file_name) index to catch the race a pre-check alone can't. */
  async create(upload: Upload): Promise<Upload> {
    const { data, error } = await this.client
      .from('uploads')
      .insert({
        id: upload.id,
        user_id: upload.userId,
        original_file_name: upload.originalFileName,
        mime_type: upload.mimeType,
        size_bytes: upload.sizeBytes,
        storage_key: upload.storageKey,
        status: upload.status,
      })
      .select()
      .single<UploadRow>()

    if (error) {
      if (error.code === '23505') {
        throw new ConflictError(`A file named "${upload.originalFileName}" has already been uploaded`)
      }
      throw new Error(`Failed to save upload metadata: ${error.message}`)
    }
    return mapRowToUpload(data)
  }

  async findExistingStorageKeys(keys: string[]): Promise<Set<string>> {
    const found = new Set<string>()
    // Chunked: the keys travel in the request URL.
    for (let i = 0; i < keys.length; i += 100) {
      const { data, error } = await this.client.from('uploads').select('storage_key').in('storage_key', keys.slice(i, i + 100)).returns<Array<{ storage_key: string }>>()
      if (error) throw new Error(`Failed to look up stored keys: ${error.message}`)
      for (const row of data ?? []) found.add(row.storage_key)
    }
    return found
  }

  async findById(id: string): Promise<Upload | null> {
    const { data, error } = await this.client.from('uploads').select().eq('id', id).maybeSingle<UploadRow>()
    // 22P02: the id isn't a valid UUID, so no such row can exist.
    if (error?.code === '22P02') return null
    if (error) throw new Error(`Failed to fetch upload: ${error.message}`)
    return data ? mapRowToUpload(data) : null
  }

  async countByUserSince(userId: string, since: string): Promise<number> {
    const { count, error } = await this.client.from('uploads').select('id', { count: 'exact', head: true }).eq('user_id', userId).gte('created_at', since)
    if (error) throw new Error(`Failed to count recent uploads: ${error.message}`)
    return count ?? 0
  }

  async storedBytesByUser(userId: string): Promise<number> {
    // Summed in the database (migration 0003). PostgREST aggregates are off
    // by default on Supabase, and a plain select returns at most db-max-rows
    // (1000) rows, so a client-side sum would undercount.
    const rpc = await this.client.rpc('user_stored_bytes', { p_user_id: userId })
    if (!rpc.error) return Number(rpc.data ?? 0)
    // PGRST202: 0003 not applied yet. Page through the rows instead.
    if (rpc.error.code !== 'PGRST202') throw new Error(`Failed to sum stored upload bytes: ${rpc.error.message}`)
    const PAGE = 1000
    let total = 0
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await this.client.from('uploads').select('size_bytes').eq('user_id', userId).order('id').range(from, from + PAGE - 1).returns<Array<{ size_bytes: number }>>()
      if (error) throw new Error(`Failed to sum stored upload bytes: ${error.message}`)
      for (const row of data ?? []) total += Number(row.size_bytes)
      if (!data || data.length < PAGE) return total
    }
  }

  async findByUserAndFilename(userId: string, fileName: string): Promise<Upload | null> {
    const { data, error } = await this.client
      .from('uploads')
      .select()
      .eq('user_id', userId)
      .eq('original_file_name', fileName)
      .maybeSingle<UploadRow>()

    if (error) throw new Error(`Failed to check for duplicate filename: ${error.message}`)
    return data ? mapRowToUpload(data) : null
  }

  async listAll(): Promise<Upload[]> {
    const { data, error } = await this.client.from('uploads').select().returns<UploadRow[]>()
    if (error) throw new Error(`Failed to list uploads: ${error.message}`)
    return (data ?? []).map(mapRowToUpload)
  }

  async findCreatedBefore(before: string, limit: number): Promise<Upload[]> {
    const { data, error } = await this.client
      .from('uploads')
      .select()
      .lt('created_at', before)
      .order('created_at', { ascending: true })
      .limit(limit)
      .returns<UploadRow[]>()
    if (error) throw new Error(`Failed to list expired uploads: ${error.message}`)
    return (data ?? []).map(mapRowToUpload)
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.client.from('uploads').delete().eq('id', id)
    if (error) throw new Error(`Failed to delete upload: ${error.message}`)
  }
}
