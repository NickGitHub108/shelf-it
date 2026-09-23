let items = [];
let activeView = 'all';
let searchTerm = '';
let currentUser = null;
let discoveryTimer = null;
let discoveryRequestId = 0;
let discoveryFilter = 'all';
let searchPageQuery = '';
let searchPageFilter = 'all';
let searchPageResults = { users: [], media: [], catalog: {} };
const catalogResults = new Map();
const $ = (selector) => document.querySelector(selector);
const typeNames = { all: 'All media', book: 'Books', movie: 'Movies', tv: 'TV Shows', music: 'Music' };
const typeLabels = { book: 'Book', movie: 'Film', tv: 'TV Show', music: 'Album' };

function getAuthHeaders() {
  const token = localStorage.getItem('shelf-it-token');
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

async function requireAuth() {
  const token = localStorage.getItem('shelf-it-token');
  if (!token) {
    currentUser = null;
    return true;
  }

  try {
    const response = await fetch('/api/auth/me', {
      headers: { Authorization: `Bearer ${token}` }
    });

    if (!response.ok) {
      localStorage.removeItem('shelf-it-token');
      currentUser = null;
      return true;
    }

    currentUser = (await response.json()).user;
    return true;
  } catch (error) {
    localStorage.removeItem('shelf-it-token');
    currentUser = null;
    return true;
  }
}

function getInitials(name) {
  if (!name) return '?';
  return name.split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

async function loadItems() {
  if (!(await requireAuth())) return;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch('/api/items', {
        headers: getAuthHeaders()
      });

      if (!response.ok) {
        throw new Error(`Shelf request failed with ${response.status}`);
      }

      items = await response.json();
      render();
      return;
    } catch (error) {
      console.error(error);
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
  }

  items = [];
  render();
  showToast('Your shelf is temporarily unavailable.');
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    "'": '&#39;',
    '"': '&quot;'
  }[character]));
}

function closeDiscovery() {
  $('#discoveryBackdrop').hidden = true;
  $('#discoveryContent').innerHTML = '';
}

function openDiscovery(content) {
  $('#discoveryContent').innerHTML = content;
  $('#discoveryBackdrop').hidden = false;
}

function renderDiscoveryResults(results) {
  const resultPanel = $('#discoveryResults');
  const users = results.users || [];
  const media = results.media || [];
  const catalog = Object.values(results.catalog || {}).flat();
  catalog.forEach((item) => catalogResults.set(`${item.source}:${item.externalId}`, item));

  if (!users.length && !media.length && !catalog.length) {
    resultPanel.innerHTML = '<div class="discovery-empty">No users or media found.</div>';
  } else {
    const filteredCatalog = discoveryFilter === 'all' ? catalog : catalog.filter((item) => item.type === discoveryFilter);
    resultPanel.innerHTML = `<div class="discovery-tabs"><button class="discovery-tab ${discoveryFilter === 'all' ? 'active' : ''}" data-discovery-filter="all">All</button><button class="discovery-tab ${discoveryFilter === 'book' ? 'active' : ''}" data-discovery-filter="book">Books</button><button class="discovery-tab ${discoveryFilter === 'movie' ? 'active' : ''}" data-discovery-filter="movie">Films</button><button class="discovery-tab ${discoveryFilter === 'tv' ? 'active' : ''}" data-discovery-filter="tv">TV</button><button class="discovery-tab ${discoveryFilter === 'music' ? 'active' : ''}" data-discovery-filter="music">Music</button></div>${discoveryFilter === 'all' && users.length ? `<div class="discovery-group"><span class="discovery-label">People</span>${users.slice(0, 4).map((user) => `<button class="discovery-result" data-discover-user="${user.id}"><span class="discovery-result-icon">@</span><span><strong>${escapeHtml(user.name)}</strong><small>Public shelf</small></span></button>`).join('')}</div>` : ''}${discoveryFilter === 'all' && media.length ? `<div class="discovery-group"><span class="discovery-label">On Shelf It</span>${media.slice(0, 4).map((item) => `<button class="discovery-result" data-discover-media="${item.id}">${item.posterUrl ? `<img class="discovery-poster" src="${escapeHtml(item.posterUrl)}" alt="" />` : `<span class="discovery-result-icon ${escapeHtml(item.color)}">${escapeHtml(item.type[0].toUpperCase())}</span>`}<span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.creator)} · ${escapeHtml(item.owner.name)}</small></span></button>`).join('')}</div>` : ''}${filteredCatalog.length ? `<div class="discovery-group"><span class="discovery-label">${discoveryFilter === 'all' ? 'Catalog' : typeNames[discoveryFilter]}</span>${filteredCatalog.slice(0, 8).map((item) => `<button class="discovery-result" data-catalog-key="${escapeHtml(`${item.source}:${item.externalId}`)}">${item.posterUrl ? `<img class="discovery-poster" src="${escapeHtml(item.posterUrl)}" alt="" />` : `<span class="discovery-result-icon ${escapeHtml(item.type)}">${escapeHtml(item.type[0].toUpperCase())}</span>`}<span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(typeLabels[item.type])} · ${escapeHtml(item.creator)}</small></span></button>`).join('')}</div>` : '<div class="discovery-empty">No matches in this category.</div>'}`;
  }

  resultPanel.hidden = false;
}

async function searchDiscovery(query) {
  if (query.trim().length < 2) {
    $('#discoveryResults').hidden = true;
    return;
  }

  const requestId = ++discoveryRequestId;
  try {
    const [localResult, catalogResult] = await Promise.allSettled([
      fetch(`/api/discover?q=${encodeURIComponent(query.trim())}`),
      fetch(`/api/catalog/search?q=${encodeURIComponent(query.trim())}`),
    ]);
    if (localResult.status !== 'fulfilled' || !localResult.value.ok) throw new Error('Unable to search local results');

    const localResults = await localResult.value.json();
    const catalog = catalogResult.status === 'fulfilled' && catalogResult.value.ok
      ? await catalogResult.value.json()
      : { books: [], movies: [], tv: [], music: [] };
    if (requestId !== discoveryRequestId || searchPageQuery) return;
    renderDiscoveryResults({ ...localResults, catalog });
  } catch (error) {
    console.error(error);
    $('#discoveryResults').innerHTML = '<div class="discovery-empty">Search is unavailable right now.</div>';
    $('#discoveryResults').hidden = false;
  }
}

async function openSearchPage(query) {
  discoveryRequestId += 1;
  searchPageQuery = query.trim();
  searchPageFilter = 'all';
  $('#discoveryResults').hidden = true;
  $('#searchPage').hidden = false;
  $('.intro').hidden = true;
  $('.stats').hidden = true;
  $('.library-section').hidden = true;
  $('#profileView').hidden = true;
  $('#breadcrumbView').textContent = 'Search';
  $('#searchPage').innerHTML = '<div class="search-page-loading">Searching the catalog...</div>';

  const [localResult, catalogResult] = await Promise.allSettled([
    fetch(`/api/discover?q=${encodeURIComponent(searchPageQuery)}`),
    fetch(`/api/catalog/search?q=${encodeURIComponent(searchPageQuery)}`),
  ]);

  const local = localResult.status === 'fulfilled' && localResult.value.ok ? await localResult.value.json() : { users: [], media: [] };
  const catalog = catalogResult.status === 'fulfilled' && catalogResult.value.ok ? await catalogResult.value.json() : { books: [], movies: [], tv: [], music: [] };
  renderSearchPage({ ...local, catalog });
}

function renderSearchPage(results) {
  searchPageResults = results;
  const catalog = Object.values(results.catalog || {}).flat();
  catalog.forEach((item) => catalogResults.set(`${item.source}:${item.externalId}`, item));
  const filteredCatalog = searchPageFilter === 'all' ? catalog : catalog.filter((item) => item.type === searchPageFilter);
  const users = searchPageFilter === 'all' ? results.users || [] : [];
  const media = searchPageFilter === 'all' ? results.media || [] : [];
  const cards = filteredCatalog.map((item) => `<button class="search-result-card" data-catalog-key="${escapeHtml(`${item.source}:${item.externalId}`)}">${item.posterUrl ? `<img src="${escapeHtml(item.posterUrl)}" alt="" />` : '<span class="search-result-placeholder">+</span>'}<span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(typeLabels[item.type])} · ${escapeHtml(item.creator)}</small><em>${escapeHtml(item.year)}</em></span></button>`).join('');
  const people = users.map((user) => `<button class="search-user-result" data-discover-user="${user.id}"><span class="discovery-result-icon">@</span><span><strong>${escapeHtml(user.name)}</strong><small>Public shelf</small></span></button>`).join('');
  const shelved = media.map((item) => `<button class="search-user-result" data-discover-media="${item.id}">${item.posterUrl ? `<img class="discovery-poster" src="${escapeHtml(item.posterUrl)}" alt="" />` : '<span class="discovery-result-icon">+</span>'}<span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.creator)} · ${escapeHtml(item.owner.name)}</small></span></button>`).join('');

  $('#searchPage').innerHTML = `<div class="search-page-heading"><div><p class="eyebrow">DISCOVERY</p><h1>Results for “${escapeHtml(searchPageQuery)}”</h1><p>Find media to add, or explore what other people are shelving.</p></div><button class="outline-button" data-close-search>Back to my shelf</button></div><div class="search-page-tabs"><button class="discovery-tab ${searchPageFilter === 'all' ? 'active' : ''}" data-search-filter="all">All</button><button class="discovery-tab ${searchPageFilter === 'book' ? 'active' : ''}" data-search-filter="book">Books</button><button class="discovery-tab ${searchPageFilter === 'movie' ? 'active' : ''}" data-search-filter="movie">Films</button><button class="discovery-tab ${searchPageFilter === 'tv' ? 'active' : ''}" data-search-filter="tv">TV</button><button class="discovery-tab ${searchPageFilter === 'music' ? 'active' : ''}" data-search-filter="music">Music</button></div>${people ? `<section class="search-page-section"><p class="eyebrow">PEOPLE</p><div class="search-people-grid">${people}</div></section>` : ''}${shelved ? `<section class="search-page-section"><p class="eyebrow">ON SHELF IT</p><div class="search-people-grid">${shelved}</div></section>` : ''}<section class="search-page-section"><p class="eyebrow">${searchPageFilter === 'all' ? 'CATALOG' : typeNames[searchPageFilter]}</p><div class="search-results-grid">${cards || '<div class="discovery-empty">No results found in this category.</div>'}</div></section>`;
}

async function showUserProfile(userId) {
  closeDiscovery();
  const response = await fetch(`/api/users/${userId}`);
  if (!response.ok) {
    showToast('Unable to load that shelf.');
    return;
  }

  const { user, items: userItems } = await response.json();
  openDiscovery(`<div class="public-profile"><p class="eyebrow">PUBLIC SHELF</p><div class="public-profile-heading"><div class="profile-avatar">${escapeHtml(getInitials(user.name))}</div><div><h1 id="discoveryTitle">${escapeHtml(user.name)}'s shelf</h1><p>${userItems.length} item${userItems.length === 1 ? '' : 's'} on shelf</p></div></div><div class="public-shelf">${userItems.length ? userItems.map((item) => `<button class="public-media" data-discover-media="${item.id}"><span class="cover ${escapeHtml(item.color)}"><span class="cover-type">${escapeHtml(typeLabels[item.type])} / ${escapeHtml(item.year)}</span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.creator)}</small></span></button>`).join('') : '<div class="discovery-empty">This shelf is empty.</div>'}</div></div>`);
}

async function showMediaDetail(itemId) {
  closeDiscovery();
  const response = await fetch(`/api/items/${itemId}`);
  if (!response.ok) {
    showToast('Unable to load that media.');
    return;
  }

  const { item, reviews } = await response.json();
  const reviewForm = currentUser ? `<form class="review-form" id="reviewForm" data-review-item="${item.id}"><label>Your review<textarea name="body" required placeholder="What did you think?"></textarea></label><div class="review-form-row"><select name="rating" aria-label="Rating"><option value="5">5 stars</option><option value="4">4 stars</option><option value="3">3 stars</option><option value="2">2 stars</option><option value="1">1 star</option></select><button class="submit-button" type="submit">Save review</button></div></form>` : '<p class="review-signin">Sign in to write a review.</p>';
  const reviewMarkup = reviews.length ? reviews.map((review) => `<article class="review"><div><strong>${escapeHtml(review.user.name)}</strong><span>${'★'.repeat(review.rating)}${'☆'.repeat(5 - review.rating)}</span></div><p>${escapeHtml(review.body)}</p></article>`).join('') : '<div class="discovery-empty">No reviews yet.</div>';

  const poster = item.posterUrl ? `<img class="catalog-poster" src="${escapeHtml(item.posterUrl)}" alt="Poster for ${escapeHtml(item.title)}" />` : '';
  openDiscovery(`<div class="media-detail"><div class="catalog-detail-head">${poster}<div><p class="eyebrow">${escapeHtml(typeLabels[item.type])} / ${escapeHtml(item.year)}</p><h1 id="discoveryTitle">${escapeHtml(item.title)}</h1><p class="media-creator">${escapeHtml(item.creator)} · Shelved by ${escapeHtml(item.owner.name)}</p></div></div><p class="catalog-description">${escapeHtml(item.description || '')}</p><div class="review-heading"><h2>Reviews</h2><span>${reviews.length}</span></div><div class="reviews">${reviewMarkup}</div>${reviewForm}</div>`);
}

function showCatalogDetail(key) {
  const item = catalogResults.get(key);
  if (!item) return;

  const formatOptions = item.type === 'book' ? '<option value="book">Book</option>' : item.type === 'music' ? '<option value="vinyl">Vinyl</option><option value="cd">CD</option>' : '<option value="dvd">DVD</option><option value="blu-ray">Blu-ray</option>';
  const addButton = currentUser ? `<div class="catalog-add"><label>Format you own<select id="catalogFormat">${formatOptions}</select></label><button class="submit-button" data-add-catalog="${escapeHtml(key)}">Add to my shelf</button></div>` : '<p class="review-signin">Sign in to add this to your shelf.</p>';
  const poster = item.posterUrl ? `<img class="catalog-poster" src="${escapeHtml(item.posterUrl)}" alt="Poster for ${escapeHtml(item.title)}" />` : '<div class="catalog-poster poster-empty">No poster</div>';
  openDiscovery(`<div class="catalog-detail"><div class="catalog-detail-head">${poster}<div><p class="eyebrow">${escapeHtml(typeLabels[item.type])} / ${escapeHtml(item.year)}</p><h1 id="discoveryTitle">${escapeHtml(item.title)}</h1><p class="media-creator">${escapeHtml(item.creator)}</p></div></div><p class="catalog-description">${escapeHtml(item.description || 'No description is available from this catalog.')}</p>${addButton}</div>`);
}

async function addCatalogItem(key) {
  const item = catalogResults.get(key);
  if (!item || !currentUser) return;

  if (!item.title || !item.creator || !item.type) {
    showToast('This catalog result is missing required details.');
    return;
  }

  const selectedFormat = $('#catalogFormat')?.value || (item.type === 'book' ? 'book' : item.type === 'music' ? 'cd' : 'dvd');
  const response = await fetch('/api/items', {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ ...item, format: selectedFormat, color: item.type === 'book' ? 'plum' : item.type === 'movie' ? 'orange' : item.type === 'tv' ? 'navy' : 'teal' })
  });

  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    showToast(result.error || 'Unable to add this title.');
    return;
  }

  closeDiscovery();
  await loadItems();
  showToast(`${item.title} is now on your shelf`);
}

function render() {
  const isProfile = activeView === 'profile';
  const isSearchPage = Boolean(searchPageQuery);
  const signedIn = Boolean(currentUser);

  $('#openModal').hidden = !signedIn;
  document.querySelector('.nav-item[data-view="profile"]').hidden = !signedIn;
  $('#profileButton').hidden = !signedIn;
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === activeView));
  $('.intro').hidden = isProfile;
  $('.stats').hidden = isProfile;
  $('.library-section').hidden = isProfile;
  $('#profileView').hidden = !isProfile;
  $('#searchPage').hidden = !isSearchPage;

  if (isSearchPage) return;

  if (isProfile) {
    renderProfile();
    return;
  }

  const filtered = items.filter((item) => (activeView === 'all' || item.type === activeView) && `${item.title} ${item.creator}`.toLowerCase().includes(searchTerm.toLowerCase()));
  $('#shelfGrid').innerHTML = filtered.length ? filtered.map(cardTemplate).join('') : '<div class="empty-state"><strong>Nothing here yet.</strong><p>Try another filter or add a new piece to your shelf.</p></div>';
  $('#sectionTitle').textContent = activeView === 'all' ? 'Everything on your shelf' : `${typeNames[activeView]} on your shelf`;
  $('#sectionSubtitle').textContent = searchTerm ? `Results for “${searchTerm}”.` : activeView === 'all' ? 'The full collection, in one place.' : `Your ${typeNames[activeView].toLowerCase()} collection.`;
  $('#breadcrumbView').textContent = typeNames[activeView];
  $('#totalStat').textContent = items.length;
  $('#favoriteStat').textContent = items.filter((item) => item.favorite).length;
  $('#recentStat').textContent = items.filter((item) => item.added && item.added.startsWith(new Date().toISOString().slice(0, 7))).length;
  $('#progressNumber').textContent = items.length;
  $('#progressBar').style.width = `${Math.min(items.length / 24 * 100, 100)}%`;
  ['all', 'book', 'movie', 'tv', 'music'].forEach((type) => {
    const count = type === 'all' ? items.length : items.filter((item) => item.type === type).length;
    $(`#${type === 'all' ? 'all' : type}Count`).textContent = count;
  });
  document.querySelectorAll('.filter-chip').forEach((button) => button.classList.toggle('active', button.dataset.filter === activeView));
}

function renderProfile() {
  const favorites = items.filter((item) => item.favorite);
  const recent = [...items].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 4);
  const displayName = currentUser?.name || 'Your';
  const profileTitle = currentUser?.name ? `${displayName}'s shelf` : 'Your shelf';
  const initials = getInitials(displayName);
  const usernameTag = displayName.toLowerCase().replace(/\s+/g, '');

  $('#breadcrumbView').textContent = 'Profile';
  $('#profileView').innerHTML = `<div class="profile-hero"><div class="profile-avatar">${initials}</div><div class="profile-copy"><p class="eyebrow">PUBLIC PROFILE</p><h1>${profileTitle}</h1><p>Collecting stories, sounds, and scenes worth keeping close.</p><div class="profile-meta"><span>@${usernameTag}</span><span>•</span><span>Member since ${new Date(currentUser?.createdAt || Date.now()).getFullYear()}</span></div></div><button class="outline-button">Share profile <span>↗</span></button></div><div class="profile-stats"><div><strong>${items.length}</strong><span>on shelf</span></div><div><strong>${favorites.length}</strong><span>favorites</span></div><div><strong>0</strong><span>following</span></div><div><strong>0</strong><span>followers</span></div></div><div class="profile-columns"><section><div class="profile-heading"><div><p class="eyebrow">THE SHORTLIST</p><h2>Favorites</h2></div><button class="text-button">See all <span>→</span></button></div><div class="favorite-shelf">${favorites.length ? favorites.map(cardTemplate).join('') : '<div class="empty-state"><strong>Your favorites are waiting.</strong><p>Star the things that define your taste.</p></div>'}</div></section><aside class="activity-panel"><div class="profile-heading"><div><p class="eyebrow">WHAT'S NEW</p><h2>Recent activity</h2></div></div>${recent.map((item) => `<div class="activity-item"><div class="activity-thumb ${item.color}">${typeLabels[item.type][0]}</div><div><p>Added <strong>${item.title}</strong></p><span>${item.creator} · ${typeLabels[item.type]}</span></div><time>${item.year}</time></div>`).join('')}<button class="follow-button">Find people to follow <span>→</span></button></aside></div>`;
}

function cardTemplate(item) {
  const signedIn = Boolean(currentUser);
  const actions = signedIn
    ? `<button class="favorite ${item.favorite ? 'is-favorite' : ''}" data-favorite="${item.id}" aria-label="${item.favorite ? 'Remove from' : 'Add to'} favorites">${item.favorite ? '*' : '+'}</button><button class="remove-card" data-remove="${item.id}" aria-label="Remove ${item.title}">remove</button>`
    : '';

  const poster = item.posterUrl ? `<img src="${escapeHtml(item.posterUrl)}" alt="Poster for ${escapeHtml(item.title)}" loading="lazy" />` : '';
  return `<article class="media-card"><div class="cover ${item.color}">${poster}<div class="cover-top"><span class="cover-type">${typeLabels[item.type]} / ${item.year || '—'}</span></div>${actions}<div class="cover-bottom"><div class="cover-title">${item.title}</div><div class="cover-creator">${item.creator}</div></div></div><div class="card-meta"><h3>${item.title}</h3><p>${item.creator}${item.format ? ` · ${item.format}` : ''}</p></div></article>`;
}

function setView(view) {
  if (view === 'profile' && !currentUser) {
    return;
  }

  activeView = view;
  render();
}

function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2300);
}

function openModal() {
  const search = $('#globalSearch');
  search.focus();
  showToast('Search for a title, artist, or author to add it.');
}

function closeModal() {
  $('#modalBackdrop').hidden = true;
  $('#mediaForm').reset();
}

document.addEventListener('click', async (event) => {
  const viewButton = event.target.closest('[data-view], [data-filter]');
  if (viewButton) {
    setView(viewButton.dataset.view || viewButton.dataset.filter);
  }

  const favorite = event.target.closest('[data-favorite]');
  if (favorite) {
    if (!currentUser) {
      showToast('Please sign in to save favorites.');
      return;
    }

    const itemId = Number(favorite.dataset.favorite);
    const item = items.find((entry) => entry.id === itemId);
    if (!item) return;

    try {
      const response = await fetch(`/api/items/${itemId}/favorite`, {
        method: 'PATCH',
        headers: getAuthHeaders()
      });
      if (!response.ok) {
        throw new Error('Unable to toggle favorite');
      }
      await loadItems();
    } catch (error) {
      console.error(error);
      showToast('Unable to update favorite');
    }
  }

  const remove = event.target.closest('[data-remove]');
  if (remove) {
    if (!currentUser) {
      showToast('Please sign in to remove items.');
      return;
    }

    const itemId = Number(remove.dataset.remove);
    const item = items.find((entry) => entry.id === itemId);
    if (!item) return;

    try {
      const response = await fetch(`/api/items/${itemId}`, {
        method: 'DELETE',
        headers: getAuthHeaders()
      });
      if (!response.ok) {
        throw new Error('Unable to delete item');
      }
      items = items.filter((entry) => entry.id !== itemId);
      render();
      showToast(`${item.title} removed from your shelf`);
    } catch (error) {
      console.error(error);
      showToast('Unable to delete item');
    }
  }
});

$('#openModal').addEventListener('click', openModal);
$('#closeModal').addEventListener('click', closeModal);
$('#modalBackdrop').addEventListener('click', (event) => { if (event.target.id === 'modalBackdrop') closeModal(); });
$('#logoutButton').addEventListener('click', () => {
  localStorage.removeItem('shelf-it-token');
  currentUser = null;
  window.location.href = '/auth.html';
});
$('#searchInput').addEventListener('input', (event) => { searchTerm = event.target.value; render(); });
$('#globalSearch').addEventListener('input', (event) => {
  clearTimeout(discoveryTimer);
  discoveryTimer = setTimeout(() => searchDiscovery(event.target.value), 180);
});
$('#globalSearch').addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    if (event.target.value.trim().length >= 2) openSearchPage(event.target.value);
  }
});
$('#searchPage').addEventListener('click', (event) => {
  const searchFilter = event.target.closest('[data-search-filter]');
  if (!searchFilter) return;

  searchPageFilter = searchFilter.dataset.searchFilter;
  renderSearchPage(searchPageResults);
});
$('#globalSearch').addEventListener('focus', (event) => {
  if (event.target.value.trim().length >= 2) searchDiscovery(event.target.value);
});
document.addEventListener('click', (event) => {
  const filter = event.target.closest('[data-discovery-filter]');
  if (filter) {
    discoveryFilter = filter.dataset.discoveryFilter;
    searchDiscovery($('#globalSearch').value);
  }
});
$('#closeDiscovery').addEventListener('click', closeDiscovery);
$('#discoveryBackdrop').addEventListener('click', (event) => {
  if (event.target.id === 'discoveryBackdrop') closeDiscovery();
});
$('#mediaForm').addEventListener('submit', async (event) => {
  event.preventDefault();

  if (!currentUser) {
    closeModal();
    showToast('Please sign in to add items.');
    return;
  }

  const form = new FormData(event.target);
  const title = form.get('title').trim();
  const creator = form.get('creator').trim();
  const type = form.get('type');
  const year = form.get('year') || '—';
  const color = form.get('color');
  const format = form.get('format');

  try {
    const response = await fetch('/api/items', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ title, creator, type, year, color, format })
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Unable to add item');
    }

    closeModal();
    await loadItems();
    setView('all');
    showToast(`${title} is now on your shelf`);
  } catch (error) {
    console.error(error);
    showToast(error.message || 'Unable to add item');
  }
});

document.addEventListener('click', (event) => {
  const closeSearch = event.target.closest('[data-close-search]');
  if (closeSearch) {
    searchPageQuery = '';
    $('#globalSearch').value = '';
    render();
    return;
  }

  const searchFilter = event.target.closest('[data-search-filter]');
  if (searchFilter) {
    searchPageFilter = searchFilter.dataset.searchFilter;
    renderSearchPage(searchPageResults);
    return;
  }

  const userResult = event.target.closest('[data-discover-user]');
  if (userResult) {
    showUserProfile(userResult.dataset.discoverUser);
    return;
  }

  const mediaResult = event.target.closest('[data-discover-media]');
  if (mediaResult) {
    showMediaDetail(mediaResult.dataset.discoverMedia);
    return;
  }

  const catalogResult = event.target.closest('[data-catalog-key]');
  if (catalogResult) {
    showCatalogDetail(catalogResult.dataset.catalogKey);
    return;
  }

  const addCatalogButton = event.target.closest('[data-add-catalog]');
  if (addCatalogButton) {
    addCatalogItem(addCatalogButton.dataset.addCatalog);
  }
});

document.addEventListener('submit', async (event) => {
  const reviewForm = event.target.closest('#reviewForm');
  if (!reviewForm) return;

  event.preventDefault();
  const form = new FormData(reviewForm);
  const response = await fetch(`/api/items/${reviewForm.dataset.reviewItem}/reviews`, {
    method: 'POST',
    headers: getAuthHeaders(),
    body: JSON.stringify({ rating: Number(form.get('rating')), body: form.get('body') })
  });

  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    showToast(result.error || 'Unable to save review.');
    return;
  }

  showMediaDetail(reviewForm.dataset.reviewItem);
});

(async () => {
  if (!(await requireAuth())) return;
  const userInitials = getInitials(currentUser?.name || 'You');
  const userButton = $('#profileButton');
  const sidebarAvatar = $('#sidebarAvatar');
  const sidebarUserName = $('#sidebarUserName');

  if (userButton) {
    userButton.textContent = userInitials;
    userButton.setAttribute('aria-label', `${currentUser?.name || 'Your'} profile`);
  }

  if (sidebarAvatar) {
    sidebarAvatar.textContent = userInitials;
  }

  if (sidebarUserName && currentUser?.name) {
    sidebarUserName.textContent = `${currentUser.name}'s shelf`;
  }

  await loadItems();
})();
