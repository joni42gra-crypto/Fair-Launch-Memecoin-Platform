import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { FileImage, Upload, X } from 'lucide-react';

export type TokenDraft = {
  name: string;
  ticker: string;
  description: string;
  x: string;
  website: string;
  telegram: string;
  imageUrl: string;
};

export const emptyTokenDraft: TokenDraft = {
  name: '', ticker: '', description: '', x: '', website: '', telegram: '', imageUrl: '',
};

export function tokenLink(value: string, kind: 'x' | 'website' | 'telegram'): string | null {
  if (!value.trim()) return null;
  try {
    const raw = value.trim();
    const url = new URL(/^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.')) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (kind === 'x' && (!['x.com', 'twitter.com'].includes(host) || url.pathname === '/')) return null;
    if (kind === 'telegram' && (!['t.me', 'telegram.me'].includes(host) || url.pathname === '/')) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function tokenDraftErrors(draft: TokenDraft): Partial<Record<keyof TokenDraft, string>> {
  const errors: Partial<Record<keyof TokenDraft, string>> = {};
  if (!draft.name.trim()) errors.name = 'Enter a token name.';
  if (!draft.ticker.trim()) errors.ticker = 'Enter a token ticker.';
  if (!draft.imageUrl) errors.imageUrl = 'Add a token image.';
  if (draft.x.trim() && !tokenLink(draft.x, 'x')) errors.x = 'Enter a valid x.com or twitter.com profile or post link.';
  if (draft.website.trim() && !tokenLink(draft.website, 'website')) errors.website = 'Enter a valid website address, including http:// or https://.';
  if (draft.telegram.trim() && !tokenLink(draft.telegram, 'telegram')) errors.telegram = 'Enter a link in the format t.me/username.';
  return errors;
}

export function TokenIdentitySection({
  draft, onChange, showErrors,
}: {
  draft: TokenDraft;
  onChange: (draft: TokenDraft) => void;
  showErrors: boolean;
}) {
  const [fileError, setFileError] = useState('');
  const [loadingImage, setLoadingImage] = useState(false);
  const [touched, setTouched] = useState<Partial<Record<keyof TokenDraft, boolean>>>({});
  const fileVersion = useRef(0);
  const currentDraft = useRef(draft);
  currentDraft.current = draft;
  useEffect(() => () => { if (draft.imageUrl) URL.revokeObjectURL(draft.imageUrl); }, [draft.imageUrl]);
  useEffect(() => () => { fileVersion.current += 1; }, []);
  const errors = tokenDraftErrors(draft);
  const errorFor = (field: keyof TokenDraft) => showErrors || touched[field] ? errors[field] : undefined;

  async function uploadImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    const version = ++fileVersion.current;
    setFileError('');
    if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 5 * 1024 * 1024) {
      setLoadingImage(false);
      setFileError('Choose a PNG, JPG, WEBP or GIF image up to 5 MB.');
      return;
    }
    const url = URL.createObjectURL(file);
    setLoadingImage(true);
    try {
      const image = new Image();
      image.src = url;
      await image.decode();
      if (version !== fileVersion.current) { URL.revokeObjectURL(url); return; }
      onChange({ ...currentDraft.current, imageUrl: url });
    } catch {
      URL.revokeObjectURL(url);
      if (version === fileVersion.current) setFileError('Could not read this image. Choose another file.');
    } finally {
      if (version === fileVersion.current) setLoadingImage(false);
    }
  }

  function field(fieldName: Exclude<keyof TokenDraft, 'imageUrl'>, label: string, limit: number, placeholder: string, multiline = false) {
    const error = errorFor(fieldName);
    const props = {
      id: `pr-token-${fieldName}`,
      value: draft[fieldName],
      maxLength: limit,
      placeholder,
      onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange({ ...draft, [fieldName]: event.target.value }),
      onBlur: () => setTouched((previous) => ({ ...previous, [fieldName]: true })),
      'aria-invalid': Boolean(error),
      'aria-describedby': error ? `pr-token-${fieldName}-error` : undefined,
    };
    return (
      <div className={`pr-identity-field pr-identity-${fieldName}`}>
        <label htmlFor={props.id}><span>{label}{['name', 'ticker'].includes(fieldName) && ' *'}</span><small>{draft[fieldName].length}/{limit}</small></label>
        {multiline ? <textarea {...props} rows={3} /> : <input {...props} type="text" autoCapitalize={['x', 'website', 'telegram'].includes(fieldName) ? 'none' : undefined} spellCheck={false} />}
        {error && <small className="pr-identity-error" id={`pr-token-${fieldName}-error`}>{error}</small>}
      </div>
    );
  }

  return (
    <div className="pr-config-section pr-identity-section">
      <div className="pr-section-heading"><span className="pr-section-number">04</span><div><h3>Name your coin</h3><p>A picture, a name and a ticker. This is what every card on the site will show.</p></div></div>
      <div className="pr-identity-grid">
        <div className="pr-image-field">
          <label className={`pr-image-upload ${draft.imageUrl ? 'has-image' : ''}`} aria-busy={loadingImage}>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" aria-label="Upload token image" onChange={uploadImage} />
            {draft.imageUrl ? <img src={draft.imageUrl} alt="Token image preview" /> : <><FileImage size={24} /><strong>{loadingImage ? 'Checking file…' : 'Token image *'}</strong><span><Upload size={12} />Choose image</span></>}
          </label>
          <div className="pr-image-caption">PNG, JPG, WEBP, GIF · up to 5 MB</div>
          {draft.imageUrl && <button className="pr-image-remove" type="button" onClick={() => { fileVersion.current += 1; setLoadingImage(false); onChange({ ...draft, imageUrl: '' }); }}><X size={11} />Remove image</button>}
          {(fileError || errorFor('imageUrl')) && <small className="pr-identity-error" role="alert">{fileError || errorFor('imageUrl')}</small>}
        </div>
        {field('name', 'Name', 32, 'Your token name')}
        {field('ticker', 'Ticker', 13, 'TICKER')}
        {field('description', 'Description', 500, 'Tell people about your token and community', true)}
      </div>
      <div className="pr-social-fields">
        {field('x', 'X — optional', 120, 'x.com/username or a post link')}
        {field('website', 'Website — optional', 200, 'https://example.com')}
        {field('telegram', 'Telegram — optional', 120, 'https://t.me/username')}
      </div>
      <p className="pr-identity-local">* Required. The image and details are used only in this preview and are not sent to a server.</p>
    </div>
  );
}
