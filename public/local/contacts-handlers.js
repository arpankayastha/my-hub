/**
 * Local API handlers for contacts (IndexedDB-backed).
 */

import { saveState, nextId, nowIso } from './store.js';

const DEFAULT_CATEGORIES = [
  { key: 'misc', name: 'Misc', label_key: 'contacts.category.misc', icon: 'users', sort_order: 0 },
  { key: 'family', name: 'Family', label_key: 'contacts.category.family', icon: 'heart', sort_order: 1 },
  { key: 'doctor', name: 'Doctor', label_key: 'contacts.category.doctor', icon: 'stethoscope', sort_order: 2 },
  { key: 'school', name: 'School', label_key: 'contacts.category.school', icon: 'graduation-cap', sort_order: 3 },
];

function apiError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function slugKey(name) {
  return String(name || 'misc').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'misc';
}

function loadPhones(state, contactId) {
  return state.contact_phones
    .filter((p) => p.contact_id === contactId)
    .map((p) => ({ id: p.id, label: p.label, value: p.value, isPrimary: p.is_primary === 1 }));
}

function loadEmails(state, contactId) {
  return state.contact_emails
    .filter((e) => e.contact_id === contactId)
    .map((e) => ({ id: e.id, label: e.label, value: e.value, isPrimary: e.is_primary === 1 }));
}

function replacePhones(state, contactId, phones) {
  state.contact_phones = state.contact_phones.filter((p) => p.contact_id !== contactId);
  if (!Array.isArray(phones)) return;
  phones.forEach((p, i) => {
    if (!p?.value) return;
    state.contact_phones.push({
      id: nextId(),
      contact_id: contactId,
      label: p.label || 'other',
      value: String(p.value).trim(),
      is_primary: p.isPrimary || i === 0 ? 1 : 0,
    });
  });
}

function replaceEmails(state, contactId, emails) {
  state.contact_emails = state.contact_emails.filter((e) => e.contact_id !== contactId);
  if (!Array.isArray(emails)) return;
  emails.forEach((e, i) => {
    if (!e?.value) return;
    state.contact_emails.push({
      id: nextId(),
      contact_id: contactId,
      label: e.label || 'other',
      value: String(e.value).trim(),
      is_primary: e.isPrimary || i === 0 ? 1 : 0,
    });
  });
}

function syncPrimaryFields(contact, state) {
  const phones = loadPhones(state, contact.id);
  const emails = loadEmails(state, contact.id);
  const primaryPhone = phones.find((p) => p.isPrimary) || phones[0];
  const primaryEmail = emails.find((e) => e.isPrimary) || emails[0];
  contact.phone = primaryPhone?.value ?? contact.phone ?? null;
  contact.email = primaryEmail?.value ?? contact.email ?? null;
}

export function ensureContactsState(state) {
  if (!Array.isArray(state.contacts)) state.contacts = [];
  if (!Array.isArray(state.contact_categories)) state.contact_categories = [];
  if (!Array.isArray(state.contact_phones)) state.contact_phones = [];
  if (!Array.isArray(state.contact_emails)) state.contact_emails = [];
  if (!state.contact_categories.length) {
    state.contact_categories = DEFAULT_CATEGORIES.map((c) => ({ ...c }));
  }
}

/**
 * @returns {object|null}
 */
export async function handleContactsApi(m, parts, query, body, state, userId) {
  ensureContactsState(state);
  const method = m.toUpperCase();

  if (parts[1] === 'categories') {
    if (parts[2] === 'reorder' && method === 'PATCH') {
      const order = Array.isArray(body?.order) ? body.order : [];
      order.forEach((key, i) => {
        const cat = state.contact_categories.find((c) => c.key === key);
        if (cat) cat.sort_order = i;
      });
      await saveState();
      return { data: state.contact_categories.sort((a, b) => a.sort_order - b.sort_order) };
    }
    const catKey = parts[2];
    if (!catKey && method === 'GET') {
      return { data: [...state.contact_categories].sort((a, b) => a.sort_order - b.sort_order) };
    }
    if (!catKey && method === 'POST') {
      const name = String(body?.name || '').trim();
      if (!name) throw apiError('Name is required.', 400);
      const key = slugKey(name);
      if (state.contact_categories.some((c) => c.key === key)) throw apiError('Category already exists.', 409);
      const cat = { key, name, label_key: null, icon: 'tag', sort_order: state.contact_categories.length };
      state.contact_categories.push(cat);
      await saveState();
      return { data: cat };
    }
    if (catKey && method === 'PUT') {
      const cat = state.contact_categories.find((c) => c.key === catKey);
      if (!cat) throw apiError('Category not found.', 404);
      const name = String(body?.name || '').trim();
      if (!name) throw apiError('Name is required.', 400);
      cat.name = name;
      await saveState();
      return { data: cat };
    }
    if (catKey && method === 'DELETE') {
      if (state.contact_categories.length <= 1) throw apiError('Cannot delete the last category.', 409);
      const inUse = state.contacts.some((c) => c.category === catKey);
      if (inUse) throw apiError('Category is in use.', 409);
      state.contact_categories = state.contact_categories.filter((c) => c.key !== catKey);
      await saveState();
      return { ok: true };
    }
    return null;
  }

  const contactId = Number(parts[1]);
  if (contactId && parts[2] === 'vcard' && method === 'GET') {
    throw apiError('Not found.', 404);
  }

  if (method === 'GET' && !parts[1]) {
    return { data: state.contacts.map((c) => ({ ...c })) };
  }

  if (method === 'POST' && !parts[1]) {
    const name = String(body?.name || '').trim();
    if (!name) throw apiError('Name is required.', 400);
    const id = nextId();
    const contact = {
      id,
      name,
      first_name: body.firstName ?? null,
      last_name: body.lastName ?? null,
      category: body.category || 'misc',
      phone: body.phone ?? null,
      email: body.email ?? null,
      address: body.address ?? null,
      notes: body.notes ?? null,
      birthday: body.birthday ?? null,
      family_user_id: null,
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    state.contacts.push(contact);
    if (body.phones) replacePhones(state, id, body.phones);
    if (body.emails) replaceEmails(state, id, body.emails);
    syncPrimaryFields(contact, state);
    await saveState();
    return {
      data: {
        ...contact,
        phones: loadPhones(state, id),
        emails: loadEmails(state, id),
      },
    };
  }

  if (contactId && method === 'GET' && !parts[2]) {
    const contact = state.contacts.find((c) => c.id === contactId);
    if (!contact) throw apiError('Contact not found.', 404);
    return {
      data: {
        ...contact,
        phones: loadPhones(state, contactId),
        emails: loadEmails(state, contactId),
      },
    };
  }

  if (contactId && method === 'PUT' && !parts[2]) {
    const contact = state.contacts.find((c) => c.id === contactId);
    if (!contact) throw apiError('Contact not found.', 404);
    if (contact.family_user_id) throw apiError('Family member contacts cannot be edited here.', 403);
    if (body.name !== undefined) contact.name = String(body.name).trim() || contact.name;
    if (body.category !== undefined) contact.category = body.category;
    if (body.phone !== undefined) contact.phone = body.phone;
    if (body.email !== undefined) contact.email = body.email;
    if (body.address !== undefined) contact.address = body.address;
    if (body.notes !== undefined) contact.notes = body.notes;
    if (body.birthday !== undefined) contact.birthday = body.birthday;
    if (body.firstName !== undefined) contact.first_name = body.firstName;
    if (body.lastName !== undefined) contact.last_name = body.lastName;
    if (body.phones !== undefined) replacePhones(state, contactId, body.phones);
    if (body.emails !== undefined) replaceEmails(state, contactId, body.emails);
    syncPrimaryFields(contact, state);
    contact.updated_at = nowIso();
    await saveState();
    return {
      data: {
        ...contact,
        phones: loadPhones(state, contactId),
        emails: loadEmails(state, contactId),
      },
    };
  }

  if (contactId && method === 'DELETE' && !parts[2]) {
    const contact = state.contacts.find((c) => c.id === contactId);
    if (!contact) throw apiError('Contact not found.', 404);
    if (contact.family_user_id) throw apiError('Family member contacts cannot be deleted.', 403);
    state.contacts = state.contacts.filter((c) => c.id !== contactId);
    state.contact_phones = state.contact_phones.filter((p) => p.contact_id !== contactId);
    state.contact_emails = state.contact_emails.filter((e) => e.contact_id !== contactId);
    await saveState();
    return { ok: true };
  }

  return null;
}
