/**
 * Local API handlers for family documents (IndexedDB-backed).
 */

import { saveState, nextId, nowIso } from './store.js';

const CATEGORIES = ['medical', 'school', 'identity', 'insurance', 'finance', 'home', 'vehicle', 'legal', 'travel', 'pets', 'warranty', 'taxes', 'work', 'other'];
const VISIBILITIES = ['family', 'restricted', 'private'];
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'text/plain', 'text/csv',
  'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

function apiError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function parseDataUrl(dataUrl) {
  const raw = String(dataUrl || '');
  const match = raw.match(/^data:([^;,]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) return { error: 'File content must be a valid base64 data URL.' };
  const mime = match[1].toLowerCase();
  if (!ALLOWED_MIME.has(mime)) return { error: 'File type is not allowed.' };
  const base64 = match[2].replace(/\s/g, '');
  const size = Math.ceil((base64.length * 3) / 4);
  if (!size) return { error: 'File content is empty.' };
  if (size > MAX_FILE_BYTES) return { error: 'File may be at most 5 MB.' };
  return { mime, base64, size, content_data: raw };
}

function canSeeDoc(doc, userId, state) {
  if (doc.created_by === userId) return true;
  if (doc.visibility === 'family') return true;
  if (doc.visibility === 'restricted') {
    return state.document_access?.some((a) => a.document_id === doc.id && a.user_id === userId);
  }
  return false;
}

function normalizeDocument(row, state, findUser) {
  if (!row) return null;
  const folder = state.document_folders?.find((f) => f.id === row.folder_id);
  const creator = findUser(row.created_by);
  const allowed = state.document_access
    ?.filter((a) => a.document_id === row.id)
    .map((a) => a.user_id) ?? [];
  return {
    ...row,
    folder_name: folder?.name ?? null,
    creator_name: creator?.display_name ?? null,
    creator_color: creator?.avatar_color ?? null,
    allowed_member_ids: allowed,
  };
}

function replaceAccess(state, documentId, memberIds) {
  if (!Array.isArray(state.document_access)) state.document_access = [];
  state.document_access = state.document_access.filter((a) => a.document_id !== documentId);
  (memberIds || []).forEach((uid) => {
    state.document_access.push({ document_id: documentId, user_id: Number(uid) });
  });
}

export function ensureDocumentsState(state) {
  if (!Array.isArray(state.documents)) state.documents = [];
  if (!Array.isArray(state.document_folders)) state.document_folders = [];
  if (!Array.isArray(state.document_access)) state.document_access = [];
}

/**
 * @returns {object|null}
 */
export async function handleDocumentsApi(m, parts, query, body, state, userId, findUser) {
  ensureDocumentsState(state);
  const method = m.toUpperCase();

  if (parts[1] === 'folders' && !parts[2] && method === 'GET') {
    return { data: state.document_folders.sort((a, b) => a.name.localeCompare(b.name)) };
  }

  if (parts[1] === 'folders' && !parts[2] && method === 'POST') {
    const name = String(body?.name || '').trim();
    if (!name) throw apiError('Name is required.', 400);
    const id = nextId();
    const folder = { id, name, created_by: userId, created_at: nowIso() };
    state.document_folders.push(folder);
    await saveState();
    return { data: folder };
  }

  const folderId = Number(parts[2]);
  if (parts[1] === 'folders' && folderId && method === 'PUT') {
    const folder = state.document_folders.find((f) => f.id === folderId);
    if (!folder) throw apiError('Folder not found.', 404);
    folder.name = String(body?.name || '').trim() || folder.name;
    await saveState();
    return { data: folder };
  }

  if (parts[1] === 'folders' && folderId && method === 'DELETE') {
    state.document_folders = state.document_folders.filter((f) => f.id !== folderId);
    state.documents.forEach((d) => { if (d.folder_id === folderId) d.folder_id = null; });
    await saveState();
    return { ok: true };
  }

  if (parts[1] === 'meta' && parts[2] === 'options' && method === 'GET') {
    return {
      data: {
        categories: CATEGORIES,
        visibilities: VISIBILITIES,
        max_file_size: MAX_FILE_BYTES,
        allowed_mime_types: [...ALLOWED_MIME],
        dms_accounts: [],
        active_upload_backend: 'local',
        is_admin: true,
      },
    };
  }

  if (parts[1] === 'dms') {
    if (parts[2] === 'search' && method === 'GET') return { data: [] };
    if (method === 'POST') throw apiError('DMS is not available in local mode.', 400);
    return null;
  }

  const docId = Number(parts[1]);
  if (docId && parts[2] === 'archive' && method === 'PATCH') {
    const doc = state.documents.find((d) => d.id === docId);
    if (!doc || !canSeeDoc(doc, userId, state)) throw apiError('Document not found.', 404);
    doc.status = body?.archived ? 'archived' : 'active';
    doc.updated_at = nowIso();
    await saveState();
    return { data: normalizeDocument(doc, state, findUser) };
  }

  if (docId && (parts[2] === 'preview' || parts[2] === 'download' || parts[2] === 'thumbnail') && method === 'GET') {
    const doc = state.documents.find((d) => d.id === docId);
    if (!doc || !canSeeDoc(doc, userId, state)) throw apiError('Document not found.', 404);
    return {
      __blob: true,
      content_data: doc.content_data,
      mime_type: doc.mime_type,
      name: doc.original_name || doc.name,
      download: parts[2] === 'download',
    };
  }

  if (method === 'GET' && !parts[1]) {
    const rows = state.documents
      .filter((d) => canSeeDoc(d, userId, state))
      .map((d) => normalizeDocument(d, state, findUser));
    return { data: rows };
  }

  if (method === 'POST' && !parts[1]) {
    const name = String(body?.name || body?.original_name || '').trim();
    if (!name) throw apiError('Name is required.', 400);
    const parsed = parseDataUrl(body.content_data);
    if (parsed.error) throw apiError(parsed.error, 400);
    let folderId = body.folder_id ? Number(body.folder_id) : null;
    if (body.folder_name && !folderId) {
      const fn = String(body.folder_name).trim();
      let folder = state.document_folders.find((f) => f.name.toLowerCase() === fn.toLowerCase());
      if (!folder) {
        folder = { id: nextId(), name: fn, created_by: userId, created_at: nowIso() };
        state.document_folders.push(folder);
      }
      folderId = folder.id;
    }
    const id = nextId();
    const doc = {
      id,
      name,
      description: body.description ?? null,
      category: body.category || 'other',
      status: body.status || 'active',
      visibility: VISIBILITIES.includes(body.visibility) ? body.visibility : 'family',
      original_name: body.original_name || name,
      mime_type: parsed.mime,
      file_size: parsed.size,
      storage_backend: 'local',
      content_data: parsed.content_data,
      folder_id: folderId,
      created_by: userId,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    state.documents.push(doc);
    replaceAccess(state, id, body.allowed_member_ids);
    await saveState();
    return { data: normalizeDocument(doc, state, findUser) };
  }

  if (docId && method === 'PUT' && !parts[2]) {
    const doc = state.documents.find((d) => d.id === docId);
    if (!doc || doc.created_by !== userId) throw apiError('Document not found.', 404);
    if (body.name !== undefined) doc.name = body.name;
    if (body.description !== undefined) doc.description = body.description;
    if (body.category !== undefined) doc.category = body.category;
    if (body.visibility !== undefined) doc.visibility = body.visibility;
    if (body.folder_id !== undefined) doc.folder_id = body.folder_id;
    if (body.allowed_member_ids !== undefined) replaceAccess(state, docId, body.allowed_member_ids);
    doc.updated_at = nowIso();
    await saveState();
    return { data: normalizeDocument(doc, state, findUser) };
  }

  if (docId && method === 'DELETE' && !parts[2]) {
    const idx = state.documents.findIndex((d) => d.id === docId);
    if (idx === -1) throw apiError('Document not found.', 404);
    state.documents.splice(idx, 1);
    state.document_access = state.document_access.filter((a) => a.document_id !== docId);
    await saveState();
    return { ok: true };
  }

  return null;
}
