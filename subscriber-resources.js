const PREFIX = 'storage://elite-subscriber-pdfs/';

export function renderResourceAction(resource, escapeHTML) {
  if (resource.url?.startsWith(PREFIX)) {
    const path = resource.url.slice(PREFIX.length);
    return `<button class="btn ghost" type="button" data-subscriber-pdf="${escapeHTML(path)}">Abrir PDF</button>`;
  }
  if (/^https?:\/\//i.test(resource.url || '')) {
    return `<a class="btn ghost" target="_blank" rel="noopener" href="${escapeHTML(resource.url)}">Abrir</a>`;
  }
  return '<span>Em breve</span>';
}

export function bindSubscriberResources(root, supabase) {
  root?.addEventListener('click', async event => {
    const button = event.target.closest('[data-subscriber-pdf]');
    if (!button || button.disabled) return;
    button.disabled = true;
    button.textContent = 'Abrindo…';
    const viewer = window.open('about:blank', '_blank');
    if (viewer) viewer.opener = null;
    try {
      // Storage RLS checks membership, active dates, level and publication status.
      const { data, error } = await supabase.storage.from('elite-subscriber-pdfs')
        .createSignedUrl(button.dataset.subscriberPdf, 60);
      if (error || !data?.signedUrl) throw error || new Error('PDF indisponível');
      if (viewer) viewer.location.replace(data.signedUrl);
      else window.location.assign(data.signedUrl);
    } catch {
      viewer?.close();
      window.alert('Não foi possível abrir o PDF. Confira se sua assinatura está ativa e tente novamente.');
    } finally {
      button.disabled = false;
      button.textContent = 'Abrir PDF';
    }
  });
}
