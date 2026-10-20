'use strict';
const crypto = require('crypto');

class MarcaPersonalError extends Error {
  constructor(message, status = 503) { super(message); this.status = status; }
}

// No se registran cuerpos de respuesta, claves, enlaces ni tokens en errores.
function createClient({ url, key, fetchImpl = fetch }) {
  if (!/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url || '') || !key) {
    throw new MarcaPersonalError('Marca Personal no está configurada.');
  }
  async function request(path, { method = 'GET', body, bearer = key } = {}) {
    let response;
    try {
      response = await fetchImpl(url + path, {
        method, headers: { apikey: key, Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000),
      });
    } catch { throw new MarcaPersonalError('No se pudo conectar con Marca Personal.'); }
    const data = await response.json().catch(() => null);
    if (!response.ok) {
      const error = new MarcaPersonalError('Marca Personal no pudo completar la operación.');
      error.upstreamStatus = response.status;
      throw error;
    }
    return data;
  }
  async function getLink(id) {
    const rows = await request('/rest/v1/gesicom_sso_links?gesicom_user_id=eq.' + id + '&select=supabase_user_id,account_id');
    return rows[0] || null;
  }
  async function findManagedUser(id) {
    return request('/rest/v1/rpc/gesicom_sso_user_id', { method: 'POST', body: { p_gesicom_user_id: Number(id) } });
  }
  async function verifyManaged(id, remoteId) {
    const user = await request('/auth/v1/admin/users/' + encodeURIComponent(remoteId));
    if (user.app_metadata?.gesicom_source !== 'gesicomm-production'
        || String(user.app_metadata?.gesicom_user_id) !== String(id)
        || user.email !== 'gesicom-' + id + '@sso.gesicomm.com') {
      throw new MarcaPersonalError('Esta cuenta no está vinculada con Gesicom.', 409);
    }
    return user;
  }
  return {
    getLink,
    async accountAccess(id, account) {
      const link=await getLink(id);
      if(!link)return false;
      const uid=encodeURIComponent(link.supabase_user_id),aid=encodeURIComponent(account);
      const [members,accounts,profiles]=await Promise.all([
        request('/rest/v1/t2e_account_memberships?user_id=eq.'+uid+'&account_id=eq.'+aid+'&select=account_id'),
        request('/rest/v1/t2e_funnel_accounts?id=eq.'+aid+'&active=eq.true&select=id'),
        request('/rest/v1/t2e_profiles?id=eq.'+uid+'&active=eq.true&deleted_at=is.null&select=module_access,role'),
      ]);
      const profile=profiles[0];
      return !!(members.length&&accounts.length&&profile&&(profile.role==='admin'||profile.module_access?.some(module=>['funnels','crm'].includes(module))));
    },
    async provision({ id, nombre, email, enabled }) {
      if (!Number.isSafeInteger(Number(id)) || Number(id) <= 0) throw new MarcaPersonalError('Usuario inválido.', 400);
      let remoteId = (await getLink(id))?.supabase_user_id;
      if (!remoteId) {
        // Nombre técnico estable: nunca se apropia de una cuenta T2E que tenga el mismo correo real.
        remoteId = await findManagedUser(id);
        if (!remoteId) {
          try {
            const user = await request('/auth/v1/admin/users', { method: 'POST', body: {
              email: 'gesicom-' + id + '@sso.gesicomm.com', password: crypto.randomBytes(48).toString('base64url'),
              email_confirm: true,
              app_metadata: { gesicom_source: 'gesicomm-production', gesicom_user_id: String(id) },
              user_metadata: { full_name: nombre },
            } });
            remoteId = user.id;
          } catch (error) {
            // Dos workers pueden competir por el mismo usuario: recupera sólo nuestra identidad.
            if (![422, 400].includes(error.upstreamStatus)) throw error;
            remoteId = await findManagedUser(id);
            if (!remoteId) throw error;
          }
        }
      }
      await verifyManaged(id, remoteId);
      return request('/rest/v1/rpc/gesicom_sso_provision', { method: 'POST', body: {
        p_gesicom_user_id: Number(id), p_supabase_user_id: remoteId,
        p_full_name: String(nombre || 'Usuario').slice(0,160), p_email: email, p_enabled: Boolean(enabled),
      } });
    },
    async session(id, remoteId) {
      const user = await verifyManaged(id, remoteId);
      const link = await request('/auth/v1/admin/generate_link', { method: 'POST', body: { type: 'magiclink', email: user.email } });
      // Verifica en el servidor: no envía correos ni expone el enlace de acceso.
      const session = await request('/auth/v1/verify', { method: 'POST', body: { type: 'magiclink', token_hash: link.hashed_token } });
      if (session?.user?.id !== remoteId || !session.access_token || !session.refresh_token) {
        throw new MarcaPersonalError('No se pudo iniciar la sesión de Marca Personal.');
      }
      return { access_token: session.access_token, refresh_token: session.refresh_token };
    },
    async managedIds() {
      const ids=[];
      for (let offset=0;;offset+=500) {
        const rows = await request('/rest/v1/gesicom_sso_links?select=gesicom_user_id&order=gesicom_user_id&limit=500&offset='+offset);
        ids.push(...rows.map(row => Number(row.gesicom_user_id)));
        if(rows.length<500)return ids;
      }
    },
    async disable(id) {
      const link = await getLink(id);
      if (!link) return;
      await verifyManaged(id, link.supabase_user_id);
      // Sólo afecta el perfil vinculado y conserva sus datos.
      await request('/rest/v1/t2e_profiles?id=eq.' + link.supabase_user_id, { method: 'PATCH', body: { active: false } });
    },
  };
}
module.exports = { createClient, MarcaPersonalError };
