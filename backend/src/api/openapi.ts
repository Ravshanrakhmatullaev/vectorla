/**
 * Hand-authored OpenAPI 3.0 document (Phase 21) — this codebase has no
 * schema-validation library (no zod/etc.) to generate a spec from, so this
 * is maintained as the source of truth alongside the route handlers rather
 * than generated from code. Served at GET /api/v1/openapi.json; see
 * backend/API.md for the human-readable version and backend/README.md for
 * why this stays hand-maintained.
 */
export const OPENAPI_DOCUMENT = {
  openapi: '3.0.3',
  info: {
    title: 'Vectorla API',
    version: '1.0.0',
    description:
      'Image-to-vector conversion API. Every response is wrapped in a standard envelope — see the SuccessResponse/ErrorResponse/PaginatedResponse schemas.',
  },
  servers: [{ url: '/api/v1' }],
  security: [{ bearerAuth: [] }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'A Supabase-issued JWT, sent as `Authorization: Bearer <token>`.',
      },
    },
    schemas: {
      Upload: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          userId: { type: 'string', format: 'uuid' },
          originalFileName: { type: 'string' },
          mimeType: { type: 'string', enum: ['image/png', 'image/jpeg', 'image/webp'] },
          sizeBytes: { type: 'integer' },
          status: { type: 'string', enum: ['pending', 'stored', 'failed'] },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Job: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          userId: { type: 'string', format: 'uuid' },
          uploadId: { type: 'string', format: 'uuid' },
          status: { type: 'string', enum: ['queued', 'processing', 'completed', 'failed'] },
          preset: {
            type: 'string',
            nullable: true,
            enum: ['logo', 'signature', 'qrCode', 'icon', 'sticker', 'blueprint', 'sketch', 'illustration', 'photo', null],
          },
          settings: { type: 'object', nullable: true, additionalProperties: { type: 'number' } },
          errorMessage: { type: 'string', nullable: true },
          retryCount: { type: 'integer' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          completedAt: { type: 'string', format: 'date-time', nullable: true },
        },
      },
      ImageAnalysis: {
        type: 'object',
        description: 'Phase 21 — computed once at upload time (see POST /uploads) and again internally before vectorization to pick a provider; not persisted.',
        properties: {
          width: { type: 'integer' },
          height: { type: 'integer' },
          aspectRatio: { type: 'number' },
          colorCountEstimate: { type: 'integer' },
          hasAlphaChannel: { type: 'boolean' },
          hasTransparency: { type: 'boolean' },
          dominantColors: { type: 'array', items: { type: 'string' }, description: 'Up to 5 approximate hex colors, most-frequent first.' },
          edgeDensity: { type: 'number' },
          noiseLevel: { type: 'number' },
          isGrayscale: { type: 'boolean' },
          imageType: { type: 'string', enum: ['photo', 'illustration', 'logo'] },
          complexityScore: { type: 'number' },
          recommendedProvider: { type: 'string', enum: ['placeholder', 'potrace', 'vision', 'openai'] },
          recommendedTracePreset: {
            type: 'string',
            enum: ['logo', 'signature', 'qrCode', 'icon', 'sticker', 'blueprint', 'sketch', 'illustration', 'photo'],
          },
          estimatedQuality: { type: 'string', enum: ['high', 'medium', 'low'] },
          estimatedCredits: { type: 'integer' },
          estimatedProcessingTimeMs: { type: 'integer' },
        },
      },
      Conversion: {
        type: 'object',
        description: 'storageKey is intentionally never included — see Phase 17 security notes in backend/README.md.',
        properties: {
          id: { type: 'string', format: 'uuid' },
          jobId: { type: 'string', format: 'uuid' },
          userId: { type: 'string', format: 'uuid' },
          format: { type: 'string', enum: ['svg', 'pdf', 'eps', 'dxf', 'png'] },
          fileSizeBytes: { type: 'integer' },
          downloadUrl: { type: 'string', nullable: true, description: 'Signed, time-limited URL — see GET /download.' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      ErrorCode: {
        type: 'string',
        enum: [
          'VALIDATION_ERROR',
          'UNAUTHORIZED',
          'FORBIDDEN',
          'NOT_FOUND',
          'CONFLICT',
          'INSUFFICIENT_CREDITS',
          'INTERNAL_ERROR',
        ],
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean', enum: [false] },
          error: {
            type: 'object',
            properties: { code: { $ref: '#/components/schemas/ErrorCode' }, message: { type: 'string' } },
          },
          requestId: { type: 'string', format: 'uuid' },
        },
      },
    },
    responses: {
      Unauthorized: { description: 'Missing/invalid auth', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      Forbidden: { description: "Resource belongs to another user", content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
      NotFound: { description: 'Resource does not exist', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
    },
  },
  paths: {
    '/health': {
      get: { summary: 'Liveness check', security: [], responses: { 200: { description: 'OK' } } },
    },
    '/uploads': {
      post: {
        summary: 'Upload a raster image and auto-enqueue its conversion job',
        requestBody: {
          required: true,
          content: {
            'multipart/form-data': {
              schema: {
                type: 'object',
                required: ['file'],
                properties: { file: { type: 'string', format: 'binary' }, plan: { type: 'string' } },
              },
            },
          },
        },
        responses: {
          201: {
            description: 'Created',
            content: {
              'application/json': {
                schema: {
                  allOf: [
                    { type: 'object', properties: { success: { type: 'boolean', enum: [true] }, requestId: { type: 'string' } } },
                    {
                      type: 'object',
                      properties: {
                        data: {
                          type: 'object',
                          properties: {
                            upload: { $ref: '#/components/schemas/Upload' },
                            job: { $ref: '#/components/schemas/Job' },
                            analysis: {
                              allOf: [{ $ref: '#/components/schemas/ImageAnalysis' }],
                              nullable: true,
                              description: 'Null if best-effort analysis failed for this upload (see API.md) — the upload/job themselves still succeeded.',
                            },
                          },
                        },
                      },
                    },
                  ],
                },
              },
            },
          },
          400: { description: 'Missing/invalid file field' },
          401: { $ref: '#/components/responses/Unauthorized' },
          409: { description: 'Duplicate filename for this user' },
          413: { description: "File exceeds the caller's plan limit" },
          415: { description: 'Unsupported MIME type or content signature mismatch' },
        },
      },
    },
    '/jobs': {
      post: {
        summary: 'Create (or resume) a conversion job for an existing upload',
        requestBody: {
          required: true,
          content: { 'application/json': { schema: { type: 'object', required: ['uploadId'], properties: { uploadId: { type: 'string' }, preset: { type: 'string' }, settings: { type: 'object' } } } } },
        },
        responses: {
          201: { description: 'Created (or the existing active job, if one was already in flight — see backend/README.md)' },
          400: { description: 'Missing/unknown uploadId' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { description: 'Upload belongs to another user' },
        },
      },
    },
    '/jobs/{id}': {
      get: {
        summary: 'Poll a job status',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'OK' }, 401: { $ref: '#/components/responses/Unauthorized' }, 403: { $ref: '#/components/responses/Forbidden' }, 404: { $ref: '#/components/responses/NotFound' } },
      },
    },
    '/jobs/{id}/conversion': {
      get: {
        summary: "Resolve a job to its conversion result once ready",
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          200: { description: 'Completed — data.conversion is populated' },
          202: { description: 'Still queued/processing — data.status only' },
          401: { $ref: '#/components/responses/Unauthorized' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { $ref: '#/components/responses/NotFound' },
          410: { description: 'Job failed — data.error has the reason' },
        },
      },
    },
    '/conversions': {
      get: {
        summary: "List the authenticated user's completed conversions",
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20, maximum: 100 } },
          { name: 'offset', in: 'query', schema: { type: 'integer', default: 0 } },
        ],
        responses: { 200: { description: 'Paginated list — see PaginatedResponse' }, 401: { $ref: '#/components/responses/Unauthorized' } },
      },
    },
    '/conversions/{id}': {
      get: {
        summary: 'Get one conversion (metadata + a fresh signed download URL)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { 200: { description: 'OK' }, 401: { $ref: '#/components/responses/Unauthorized' }, 403: { $ref: '#/components/responses/Forbidden' }, 404: { $ref: '#/components/responses/NotFound' } },
      },
    },
    '/download': {
      get: {
        summary: 'Stream a completed conversion file — the one endpoint that does NOT use the JSON envelope on success (raw file bytes)',
        parameters: [
          { name: 'key', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'exp', in: 'query', required: true, schema: { type: 'integer' } },
          { name: 'sig', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          200: { description: 'The file, streamed directly (Content-Type matches the conversion format)' },
          401: { description: 'Missing auth, or missing/invalid signature' },
          403: { $ref: '#/components/responses/Forbidden' },
          404: { description: 'No conversion matches, or the R2 object is missing' },
          410: { description: 'Download link expired, or the job is not completed' },
        },
      },
    },
  },
} as const
