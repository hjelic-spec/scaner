'use strict';

// Zajednička baza proizvoda (Supabase). Sve izmjene idu kroz RPC funkcije iz supabase/migrations.
const Api = (() => {
  const cfg = window.APP_CONFIG || {};
  const enabled = Boolean(cfg.supabaseUrl && cfg.supabaseAnonKey && window.supabase);
  const BUCKET = 'product-images';
  const sb = enabled
    ? window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
    : null;

  function check({ data, error }) {
    if (error) {
      const err = new Error(error.message || 'Greška u komunikaciji s bazom.');
      err.code = error.code;
      throw err;
    }
    return data;
  }

  async function getProduct(code) {
    const product = check(await sb.from('products')
      .select('code, status, data, current_revision_id, created_at, updated_at')
      .eq('code', code)
      .maybeSingle());
    if (!product) return null;

    const [current, pending] = await Promise.all([
      product.current_revision_id
        ? sb.from('revisions').select('id, author, confirmations, reports, created_at')
          .eq('id', product.current_revision_id).maybeSingle().then(check)
        : null,
      sb.from('revisions').select('id, data, author, confirmations, reports, created_at')
        .eq('code', code).eq('state', 'pending').order('created_at', { ascending: false }).then(check),
    ]);
    product.current = current;
    product.pending = pending || [];
    return product;
  }

  async function myVotes(revisionIds) {
    const user = await currentUser();
    if (!user || !revisionIds.length) return {};
    const rows = check(await sb.from('votes').select('revision_id, value').in('revision_id', revisionIds));
    return Object.fromEntries(rows.map((r) => [r.revision_id, r.value]));
  }

  async function submit(code, data) {
    return check(await sb.rpc('submit_revision', { p_code: code, p_data: data }));
  }

  async function vote(revisionId, value, comment) {
    return check(await sb.rpc('vote', { p_revision_id: revisionId, p_value: value, p_comment: comment || null }));
  }

  async function uploadImage(code, blob) {
    const user = await currentUser();
    if (!user) throw new Error('Za slanje fotografije potrebna je prijava.');
    const path = `${user.id}/${code}-${Date.now()}.jpg`;
    check(await sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false }));
    return path;
  }

  function imageUrl(path) {
    if (!sb || !path) return null;
    return sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl;
  }

  /* ---------- Prijava (jednokratni kod e-poštom) ---------- */

  async function currentUser() {
    if (!sb) return null;
    const { data } = await sb.auth.getSession();
    return data.session ? data.session.user : null;
  }

  async function sendCode(email) {
    check(await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } }));
  }

  async function verifyCode(email, token) {
    return check(await sb.auth.verifyOtp({ email, token, type: 'email' }));
  }

  async function signOut() {
    check(await sb.auth.signOut());
  }

  async function deleteAccount() {
    check(await sb.rpc('delete_my_account'));
    await sb.auth.signOut().catch(() => {});
  }

  async function isAdmin() {
    if (!(await currentUser())) return false;
    return Boolean(check(await sb.rpc('is_admin')));
  }

  function onAuthChange(fn) {
    if (sb) sb.auth.onAuthStateChange((_event, session) => fn(session ? session.user : null));
  }

  return {
    enabled, getProduct, myVotes, submit, vote, uploadImage, imageUrl,
    currentUser, sendCode, verifyCode, signOut, deleteAccount, isAdmin, onAuthChange,
  };
})();
