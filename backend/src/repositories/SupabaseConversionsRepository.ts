import type { SupabaseClient } from '@supabase/supabase-js'
import type { Conversion, ExportFormat } from '../types'
import type { ConversionsRepository } from './ConversionsRepository'

// Mirrors backend/supabase/schema.sql's `conversions` table exactly.
// `downloadUrl` is never persisted — it's populated on demand via
// StorageService.getSignedDownloadUrl (see types/conversion.ts).
interface ConversionRow {
  id: string
  job_id: string
  user_id: string
  format: string
  storage_key: string
  file_size_bytes: number
  created_at: string
}

function mapRowToConversion(row: ConversionRow): Conversion {
  return {
    id: row.id,
    jobId: row.job_id,
    userId: row.user_id,
    format: row.format as ExportFormat,
    storageKey: row.storage_key,
    fileSizeBytes: row.file_size_bytes,
    downloadUrl: null,
    createdAt: row.created_at,
  }
}

/** Real Supabase-backed implementation — used whenever SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are configured (see createConversionsRepository). */
export class SupabaseConversionsRepository implements ConversionsRepository {
  constructor(private readonly client: SupabaseClient) {}

  async create(conversion: Conversion): Promise<Conversion> {
    const { data, error } = await this.client
      .from('conversions')
      .insert({
        id: conversion.id,
        job_id: conversion.jobId,
        user_id: conversion.userId,
        format: conversion.format,
        storage_key: conversion.storageKey,
        file_size_bytes: conversion.fileSizeBytes,
      })
      .select()
      .single<ConversionRow>()

    if (error) throw new Error(`Failed to save conversion metadata: ${error.message}`)
    return mapRowToConversion(data)
  }

  async findById(id: string): Promise<Conversion | null> {
    const { data, error } = await this.client.from('conversions').select().eq('id', id).maybeSingle<ConversionRow>()
    if (error) throw new Error(`Failed to fetch conversion: ${error.message}`)
    return data ? mapRowToConversion(data) : null
  }

  async findByJobId(jobId: string): Promise<Conversion | null> {
    const { data, error } = await this.client
      .from('conversions')
      .select()
      .eq('job_id', jobId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle<ConversionRow>()

    if (error) throw new Error(`Failed to fetch conversion for job: ${error.message}`)
    return data ? mapRowToConversion(data) : null
  }

  async findByUserId(userId: string): Promise<Conversion[]> {
    const { data, error } = await this.client
      .from('conversions')
      .select()
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .returns<ConversionRow[]>()

    if (error) throw new Error(`Failed to list conversions: ${error.message}`)
    return (data ?? []).map(mapRowToConversion)
  }
}
