import { getStore } from '@netlify/blobs';
import { timingSafeEqual } from 'node:crypto';

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' },
});

function authorized(request) {
  const configured = process.env.GELADEIRA_SENHA;
  if (!configured || configured.length < 12) return null;
  const supplied = request.headers.get('X-Geladeira-Senha') || '';
  const a = Buffer.from(supplied, 'utf8');
  const b = Buffer.from(configured, 'utf8');
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(request) {
  if (!process.env.GELADEIRA_SENHA || process.env.GELADEIRA_SENHA.length < 12) {
    return json({ error: 'Configure a variável GELADEIRA_SENHA na Netlify (pelo menos 12 caracteres).' }, 503);
  }
  if (!authorized(request)) return json({ error: 'Senha incorreta.' }, 401);
  const method = request.method;
  const store = getStore({ name: 'minha-geladeira-cervejas', consistency: 'strong' });
  try {
    if (method === 'GET') {
      const { blobs } = await store.list({ prefix: 'beer-' });
      const entries = (await Promise.all(blobs.map(x => store.get(x.key, { type: 'json', consistency: 'strong' })))).filter(Boolean);
      return json({ entries });
    }
    if (method === 'POST') {
      const size = Number(request.headers.get('content-length') || 0);
      if (size > 2_500_000) return json({ error: 'Imagem ou cadastro muito grande. Use uma foto menor.' }, 413);
      const raw = await request.text();
      if (raw.length > 2_500_000) return json({ error: 'Cadastro muito grande.' }, 413);
      let entry;
      try { entry = JSON.parse(raw); } catch { return json({ error: 'JSON inválido.' }, 400); }
      const id = String(entry?.id || '');
      const rating = Number(entry?.rating);
      if (!/^[0-9a-f-]{36}$/i.test(id) || !entry?.name?.trim() || !entry?.brand?.trim() ||
          String(entry.rating ?? '').trim() === '' || !Number.isFinite(rating) || rating < 0 || rating > 10)
        return json({ error: 'Nome, marca e nota válida (0 a 10) são obrigatórios.' }, 400);
      if (entry.image && (!/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(entry.image) || entry.image.length > 1_900_000))
        return json({ error: 'Formato ou tamanho da foto inválido.' }, 400);
      const allowed = ['id','name','brand','manufacturer','style','abv','volume','store','price','date','rating','description','image','created'];
      const clean = Object.fromEntries(allowed.filter(k => Object.hasOwn(entry, k)).map(k => [k, entry[k]]));
      clean.id = id;
      clean.rating = String(rating);
      await store.setJSON('beer-' + id, clean);
      return json({ ok: true, id });
    }
    if (method === 'DELETE') {
      const id = new URL(request.url).searchParams.get('id') || '';
      if (!/^[0-9a-f-]{36}$/i.test(id)) return json({ error: 'ID inválido.' }, 400);
      await store.delete('beer-' + id);
      return json({ ok: true });
    }
    return json({ error: 'Método não permitido.' }, 405);
  } catch (error) {
    console.error('Erro no armazenamento da Minha Geladeira:', error);
    return json({ error: 'Falha no armazenamento da Netlify. Tente novamente.' }, 500);
  }
}
