import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Compass,
  FileImage,
  Info,
  LayoutGrid,
  Search,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
} from 'lucide-react';
import { useMemo, useState, type ChangeEvent } from 'react';
import {
  supportedPairCatalog,
  type PairAssetCategory,
  type PairAssetGroup,
} from '../../../../../api-server/src/data/supported-pair-assets';
import './_group.css';
import './Updated.css';
import { emptyTokenDraft, TokenIdentitySection, tokenDraftErrors, tokenLink, type TokenDraft } from './_TokenIdentity';

type PairType = 'supported-memecoin' | 'tokenized-stock' | 'other-supported-token';
type CatalogAsset = {
  source: 'catalog';
  name: string;
  ticker: string;
  mintAddress: string;
  category: PairAssetCategory;
  assetGroup: PairAssetGroup;
  pairType: PairType;
  catalogStatus: 'listed';
  compatibilityStatus: 'not-checked';
};
type ManualAsset = {
  source: 'manual';
  name: string;
  ticker: string;
  mintAddress: string;
  category: PairAssetCategory;
  pairType: PairType;
  catalogStatus: 'not-listed';
  compatibilityStatus: 'not-checked';
};
type SelectedAsset = CatalogAsset | ManualAsset;
type GroupFilter = 'all' | PairAssetGroup;

const xstocksMints = new Set(supportedPairCatalog.assetGroups.xstocks);
const backpackMints = new Set(supportedPairCatalog.assetGroups.backpack);
const catalogAssets: CatalogAsset[] = supportedPairCatalog.assets.map(
  ([ticker, name, mintAddress, category]) => ({
    source: 'catalog',
    ticker,
    name,
    mintAddress,
    category,
    assetGroup: xstocksMints.has(mintAddress)
      ? 'xstocks'
      : backpackMints.has(mintAddress)
        ? 'backpack'
        : 'crypto',
    pairType: pairTypeForCategory(category),
    catalogStatus: 'listed',
    compatibilityStatus: 'not-checked',
  }),
);

function pairTypeForCategory(category: PairAssetCategory): PairType {
  if (category === 'tokenized-stock') return 'tokenized-stock';
  if (category === 'memecoin' || category === 'pumpfun-coin') {
    return 'supported-memecoin';
  }
  return 'other-supported-token';
}

function pairTypeLabel(pairType: PairType | undefined) {
  if (pairType === 'tokenized-stock') return 'Токенизированная акция';
  if (pairType === 'supported-memecoin') return 'Поддерживаемый мемкоин';
  if (pairType === 'other-supported-token') return 'Другой поддерживаемый токен';
  return 'Не выбран';
}

function groupLabel(group: PairAssetGroup) {
  if (group === 'xstocks') return 'xStocks';
  if (group === 'backpack') return 'Backpack';
  return 'Crypto';
}

function shortMint(mint: string) {
  return `${mint.slice(0, 5)}…${mint.slice(-5)}`;
}

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function validMint(value: string) {
  const address = value.trim();
  if (address.length < 32 || address.length > 44 || !/^[1-9A-HJ-NP-Za-km-z]+$/.test(address)) return false;
  let decoded = 0n;
  for (const character of address) {
    const digit = BASE58.indexOf(character);
    if (digit < 0) return false;
    decoded = decoded * 58n + BigInt(digit);
  }
  let byteCount = 0;
  while (decoded > 0n) {
    decoded >>= 8n;
    byteCount += 1;
  }
  return byteCount + (address.match(/^1*/)?.[0].length ?? 0) === 32;
}

function CatalogGlyph({ ticker }: { ticker: string }) {
  return (
    <span className="pr-asset-glyph" aria-label="Официальная иконка не указана">
      {ticker.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function Updated() {
  const initialSol = catalogAssets.find((asset) => asset.ticker === 'SOL') ?? null;
  const [selectedAsset, setSelectedAsset] = useState<SelectedAsset | null>(initialSol);
  const [groupFilter, setGroupFilter] = useState<GroupFilter>('all');
  const [search, setSearch] = useState('');
  const [rewardBps, setRewardBps] = useState(50);
  const [manualOpen, setManualOpen] = useState(false);
  const [manualMint, setManualMint] = useState('');
  const [manualPairType, setManualPairType] = useState<PairType>('other-supported-token');
  const [showDemoNotice, setShowDemoNotice] = useState(false);
  const [tokenDraft, setTokenDraft] = useState<TokenDraft>(emptyTokenDraft);
  const [showIdentityErrors, setShowIdentityErrors] = useState(false);

  function previewProposal() {
    setShowIdentityErrors(true);
    if (Object.keys(tokenDraftErrors(tokenDraft)).length > 0) {
      document.querySelector('.pr-identity-section')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    setShowDemoNotice(true);
  }

  const groupCounts = {
    all: catalogAssets.length,
    xstocks: catalogAssets.filter((asset) => asset.assetGroup === 'xstocks').length,
    backpack: catalogAssets.filter((asset) => asset.assetGroup === 'backpack').length,
    crypto: catalogAssets.filter((asset) => asset.assetGroup === 'crypto').length,
  };

  const visibleAssets = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    return catalogAssets.filter((asset) => {
      const groupMatches = groupFilter === 'all' || asset.assetGroup === groupFilter;
      const queryMatches =
        !query ||
        asset.name.toLocaleLowerCase().includes(query) ||
        asset.ticker.toLocaleLowerCase().includes(query) ||
        asset.mintAddress.toLocaleLowerCase().includes(query);
      return groupMatches && queryMatches;
    });
  }, [groupFilter, search]);

  function chooseManualMint() {
    if (!validMint(manualMint)) return;
    setSelectedAsset({
      source: 'manual',
      name: 'Пользовательский mint',
      ticker: 'MANUAL',
      mintAddress: manualMint.trim(),
      category: 'other',
      pairType: manualPairType,
      catalogStatus: 'not-listed',
      compatibilityStatus: 'not-checked',
    });
  }

  function onSearchChange(event: ChangeEvent<HTMLInputElement>) {
    setSearch(event.target.value);
  }

  const tabs: { id: GroupFilter; label: string }[] = [
    { id: 'all', label: 'All' },
    { id: 'xstocks', label: 'xStocks' },
    { id: 'backpack', label: 'Backpack' },
    { id: 'crypto', label: 'Crypto' },
  ];

  return (
    <div className="app-shell fairlaunch-concept">
      <aside className="pr-sidebar">
        <a href="#" className="pr-brand" aria-label="Fairlaunch, главная">
          <span className="pr-brand-mark">f</span>
          <span>fairlaunch</span>
        </a>
        <nav className="pr-nav" aria-label="Основная навигация">
          <span className="pr-nav-label">Рабочее пространство</span>
          <a className="pr-nav-item" href="#"><Compass size={16} />Обзор</a>
          <a className="pr-nav-item" href="#"><Search size={16} />Исследовать</a>
          <a className="pr-nav-item active" href="#" aria-current="page"><Sparkles size={16} />Предложить</a>
          <a className="pr-nav-item" href="#"><Activity size={16} />Активность</a>
          <span className="pr-nav-label pr-nav-label-lower">Справка</span>
          <a className="pr-nav-item" href="#"><CircleHelp size={16} />Документация</a>
        </nav>
        <div className="pr-sidebar-note">
          <span className="pr-sidebar-note-icon"><ShieldCheck size={15} /></span>
          <span><strong>Демо-прототип</strong><small>Без кошелька и транзакций</small></span>
        </div>
      </aside>

      <div className="pr-workspace">
        <header className="pr-topbar">
          <div className="pr-breadcrumb"><span>Предложение</span><span>/</span><strong>Торговая пара</strong></div>
          <div className="pr-topbar-actions">
            <span className="pr-demo-status"><i /> DEMO MODE</span>
            <button type="button" className="pr-wallet-button" disabled title="Подключение кошелька не входит в прототип">
              <Wallet size={14} />Подключить
            </button>
          </div>
        </header>

        <main className="pr-page">
          <div className="pr-step-heading">
            <div className="pr-step-eyebrow">ШАГ 1 <span>/</span> 3</div>
            <h1>Выбери торговую пару</h1>
            <p>Твой токен будет торговаться против выбранного актива, а награды будут распределяться между подходящими держателями.</p>
            <div className="pr-progress" aria-label="Шаг 1 из 3">
              <span className="current" /><span /><span />
            </div>
          </div>

          <div className="pr-content-grid">
            <section className="pr-config-card" aria-label="Настройка торговой пары">
              <div className="pr-config-header">
                <div><span className="pr-kicker">НАСТРОЙКИ ПРЕДЛОЖЕНИЯ</span><h2>Условия торговой пары</h2></div>
                <span className="pr-required"><i />Обязательные настройки</span>
              </div>

              <div className="pr-config-section pr-launch-section">
                <div className="pr-section-heading"><span className="pr-section-number">01</span><h3>Платформа запуска</h3></div>
                <div className="pr-platform-card" aria-label="Единственная платформа: Pump.fun">
                  <span className="pr-platform-mark"><Sparkles size={16} /></span>
                  <span><strong>Pump.fun</strong><small>Единственная платформа в этой концепции</small></span>
                  <span className="pr-selected-label"><Check size={13} />Выбрано</span>
                </div>
              </div>

              <div className="pr-config-section pr-reward-section">
                <div className="pr-section-heading"><span className="pr-section-number">02</span><div><h3>Механика наград</h3><p>Один механизм распределения для подходящих держателей.</p></div></div>
                <div className="pr-reward-card" role="group" aria-label="Выбранная механика Reward">
                  <span className="pr-reward-icon"><UsersIcon /></span>
                  <span className="pr-reward-copy"><strong>Reward</strong><small>Торговые комиссии распределяются между подходящими держателями токена</small></span>
                  <span className="pr-reward-check"><Check size={14} />Выбрано</span>
                </div>
                <div className="pr-rate-heading"><h4>Комиссия для держателей</h4><span>СТАВКА</span></div>
                <div className="pr-rate-readout"><label htmlFor="pr-reward-rate">Предлагаемая ставка</label><strong>{(rewardBps / 100).toFixed(2)}<small>%</small></strong></div>
                <input
                  id="pr-reward-rate"
                  className="pr-range"
                  type="range"
                  min={1}
                  max={300}
                  step={1}
                  value={rewardBps}
                  onChange={(event) => setRewardBps(Number(event.target.value))}
                  aria-label="Комиссия для держателей"
                  aria-valuetext={`${(rewardBps / 100).toFixed(2)} процента`}
                />
                <div className="pr-rate-ticks"><span>0,01%</span><span>1,5%</span><span>3%</span></div>
                <div className="pr-rate-note"><Info size={15} /><p>Ставка зависит от выбранной пары и правил Pump.fun. Это ставка распределения, а не отдельный сбор поверх других комиссий; каталог не подтверждает совместимость пары или доступность ставки.</p></div>
              </div>

              <div className="pr-config-section pr-pairs-section">
                <div className="pr-section-heading"><span className="pr-section-number">03</span><div><h3>Торговая пара</h3><p>Активы из опубликованного списка Pump.fun. Совместимость каждого mint отдельно не проверена.</p></div></div>
                <div className="pr-pair-toolbar">
                  <div className="pr-pair-tabs" role="group" aria-label="Фильтр каталога">
                    {tabs.map((tab) => (
                      <button
                        type="button"
                        key={tab.id}
                        className={groupFilter === tab.id ? 'active' : ''}
                        aria-pressed={groupFilter === tab.id}
                        onClick={() => setGroupFilter(tab.id)}
                      >
                        {tab.label}<span>{groupCounts[tab.id]}</span>
                      </button>
                    ))}
                  </div>
                  <label className="pr-search-box">
                    <Search size={15} />
                    <input value={search} onChange={onSearchChange} placeholder="По тикеру, названию или mint" aria-label="Поиск в каталоге" />
                    {search && <button type="button" aria-label="Очистить поиск" onClick={() => setSearch('')}><X size={14} /></button>}
                  </label>
                </div>
                <div className="pr-catalog-meta">
                  <span>{visibleAssets.length} из {groupCounts[groupFilter]} активов</span>
                  <span>Снимок: {supportedPairCatalog.snapshotCapturedAt}</span>
                </div>
                {visibleAssets.length > 0 ? (
                  <div className="pr-asset-grid" aria-label="Результаты каталога">
                    {visibleAssets.map((asset) => (
                      <button
                        type="button"
                        key={asset.mintAddress}
                        className={`pr-asset-card ${selectedAsset?.mintAddress === asset.mintAddress ? 'selected' : ''}`}
                        aria-pressed={selectedAsset?.mintAddress === asset.mintAddress}
                        title={`${asset.name} · ${asset.mintAddress}`}
                        onClick={() => setSelectedAsset(asset)}
                      >
                        <CatalogGlyph ticker={asset.ticker} />
                        <span className="pr-asset-copy">
                          <strong>{asset.ticker}</strong>
                          <small>{asset.name}</small>
                          <code>{shortMint(asset.mintAddress)}</code>
                        </span>
                        {selectedAsset?.mintAddress === asset.mintAddress && <CheckCircle2 size={14} className="pr-asset-check" />}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="pr-no-results"><Search size={18} /><strong>Ничего не найдено</strong><span>Измени запрос или выбери другую группу.</span></div>
                )}
                <div className="pr-source-note">
                  <Info size={14} />
                  <span>Группы xStocks и Backpack выделены по данным эмитента; Crypto — остальные записи. <a href={supportedPairCatalog.sourceUrl} target="_blank" rel="noreferrer">Официальный источник</a></span>
                </div>

                <div className="pr-manual-entry">
                  <button type="button" className="pr-manual-toggle" aria-expanded={manualOpen} onClick={() => setManualOpen((open) => !open)}>
                    <span><strong>Ввести mint вручную</strong><small>Только кандидат; совместимость не проверяется</small></span>
                    <ChevronDown size={16} className={manualOpen ? 'open' : ''} />
                  </button>
                  {manualOpen && (
                    <div className="pr-manual-fields">
                      <label>
                        Адрес mint Solana
                        <input value={manualMint} onChange={(event) => setManualMint(event.target.value)} placeholder="Введите Base58 mint" spellCheck={false} />
                      </label>
                      <label>
                        Категория актива
                        <select value={manualPairType} onChange={(event) => setManualPairType(event.target.value as PairType)}>
                          <option value="supported-memecoin">Поддерживаемый мемкоин</option>
                          <option value="tokenized-stock">Токенизированная акция</option>
                          <option value="other-supported-token">Другой поддерживаемый токен</option>
                        </select>
                      </label>
                      <button type="button" className="pr-manual-select" disabled={!validMint(manualMint)} onClick={chooseManualMint}>Выбрать непроверенный mint</button>
                      {manualMint && !validMint(manualMint) && <small className="pr-manual-error">Проверь формат Base58 и длину 32 байта.</small>}
                    </div>
                  )}
                </div>
              </div>

              <TokenIdentitySection draft={tokenDraft} onChange={setTokenDraft} showErrors={showIdentityErrors} />

              <div className="pr-step-actions">
                <button type="button" className="pr-back-button" disabled><ArrowLeft size={15} />Назад</button>
                <button type="button" className="pr-continue-button" onClick={previewProposal}>Продолжить <ArrowRight size={15} /></button>
              </div>
            </section>

            <aside className="pr-summary">
              <section className="pr-summary-card">
                <div className="pr-summary-title"><h2>Предпросмотр токена</h2><span>ДЕМО</span></div>
                <div className="pr-token-summary">
                  {tokenDraft.imageUrl ? <img className="pr-summary-token-image" src={tokenDraft.imageUrl} alt="Изображение твоего токена" /> : <span className="pr-empty-glyph"><FileImage size={17} /></span>}
                  <span><strong>{tokenDraft.name.trim() || 'Название токена'}</strong><small>{tokenDraft.ticker.trim() ? `$${tokenDraft.ticker.trim()}` : 'Тикер не указан'}</small></span>
                </div>
                {tokenDraft.description.trim() && <p className="pr-summary-description">{tokenDraft.description}</p>}
                <div className="pr-summary-socials">
                  {(['x', 'website', 'telegram'] as const).map((kind) => {
                    const href = tokenLink(tokenDraft[kind], kind);
                    return href ? <a key={kind} href={href} target="_blank" rel="noopener noreferrer">{kind === 'website' ? 'Сайт' : kind === 'telegram' ? 'Telegram' : 'X'} ↗</a> : null;
                  })}
                </div>
                <div className="pr-summary-lines">
                  <div><span>Платформа</span><strong>Pump.fun</strong></div>
                  <div><span>Тип актива</span><strong>{pairTypeLabel(selectedAsset?.pairType)}</strong></div>
                  <div><span>Пара</span><strong>{selectedAsset?.ticker ?? '—'}</strong></div>
                  <div><span>Награда держателям</span><strong>{(rewardBps / 100).toFixed(2)}%</strong></div>
                  <div><span>Каталог</span><strong>{selectedAsset?.catalogStatus === 'listed' ? 'В списке' : selectedAsset ? 'Не в списке' : '—'}</strong></div>
                  <div><span>Совместимость</span><strong className="pr-unverified">Не проверена</strong></div>
                </div>
                {selectedAsset && <code className="pr-summary-mint">{shortMint(selectedAsset.mintAddress)}</code>}
                <div className="pr-summary-caution"><ShieldCheck size={14} /><span>Запись в каталоге сама по себе не разрешает реальный запуск.</span></div>
                <button type="button" className="pr-summary-disabled" disabled title="Запуск токена не входит в прототип">Запуск недоступен в демо</button>
              </section>

              <section className="pr-community-card">
                <span className="pr-kicker">СТАРТ СООБЩЕСТВА</span>
                <h2>Общая цель</h2>
                <div className="pr-community-stats">
                  <span><strong>$10</strong><small>с участника</small></span>
                  <span><strong>100</strong><small>участников</small></span>
                  <span><strong>$1,000</strong><small>цель</small></span>
                </div>
                <p>Окно сбора — 1 час. Если программа будет запущена и цель не достигнута, участники смогут запросить возврат по правилам программы.</p>
                <div className="pr-not-started"><i />Сбор не начался</div>
                <small className="pr-demo-only">Это параметры концепции; средства не собираются.</small>
              </section>

              <p className="pr-privacy"><ShieldCheck size={14} />Демо-концепция: никаких токенов, сборов или транзакций.</p>
            </aside>
          </div>
        </main>
      </div>

      {showDemoNotice && (
        <div className="pr-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowDemoNotice(false); }}>
          <section className="pr-demo-modal" role="dialog" aria-modal="true" aria-labelledby="pr-demo-title">
            <button type="button" className="pr-modal-close" aria-label="Закрыть" onClick={() => setShowDemoNotice(false)}><X size={17} /></button>
            <span className="pr-modal-icon"><ShieldCheck size={21} /></span>
            <span className="pr-kicker">ПРЕДПРОСМОТР</span>
            <h2 id="pr-demo-title">Только концепция</h2>
            <p>Этот макет показывает интерфейс выбора пары. Он не создаёт токен, не собирает деньги и не отправляет транзакции. Совместимость выбранного актива не проверена.</p>
            <button type="button" className="pr-continue-button" onClick={() => setShowDemoNotice(false)}>Понятно <Check size={15} /></button>
          </section>
        </div>
      )}
    </div>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16 20v-1.6c0-1.3-1.2-2.4-2.7-2.4H6.7C5.2 16 4 17.1 4 18.4V20M10 12a3.2 3.2 0 1 0 0-6.4A3.2 3.2 0 0 0 10 12ZM17 7.2a2.5 2.5 0 0 1 0 4.8M20 19v-.7c0-1.1-.8-2-2-2.3" />
    </svg>
  );
}
