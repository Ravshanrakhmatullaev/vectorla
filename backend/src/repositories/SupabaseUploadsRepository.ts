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
    // Summed here: PostgREST aggregates are off by default on Supabase. Rows
    // are bounded by the upload rate limits within the retention period.
    const { data, error } = await this.client.from('uploads').select('size_bytes').eq('user_id', userId).limit(100_000).returns<Array<{ size_bytes: number }>>()
    if (error) throw new Error(`Failed to sum stored upload bytes: ${error.message}`)
    return (data ?? []).reduce((sum, row) => sum + Number(row.size_bytes), 0)
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
