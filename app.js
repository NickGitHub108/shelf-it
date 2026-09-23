let items = [];
let activeView = 'all';
let searchTerm = '';
let currentUser = null;
const $ = (selector) => document.querySelector(selector);
const typeNames = { all: 'All media', book: 'Books', movie: 'Movies', music: 'Music' };
const typeLabels = { book: 'Book', movie: 'Film', music: 'Record' };

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
  if (!name) return 'NS';
  return name.split(' ').slice(0, 2).map((part) => part[0]).join('').toUpperCase();
}

async function loadItems() {
  if (!(await requireAuth())) return;

  try {
    const response = await fetch('/api/items', {
      headers: getAuthHeaders()
    });

    if (!response.ok) {
      throw new Error('Unable to load shelf items');
    }
    items = await response.json();
    render();
  } catch (error) {
    console.error(error);
    showToast('Unable to load shelf items');
  }
}

function render() {
  const isProfile = activeView === 'profile';
  const signedIn = Boolean(currentUser);

  $('#openModal').hidden = !signedIn;
  document.querySelectorAll('.nav-item').forEach((button) => button.classList.toggle('active', button.dataset.view === activeView));
  $('.intro').hidden = isProfile;
  $('.stats').hidden = isProfile;
  $('.library-section').hidden = isProfile;
  $('#profileView').hidden = !isProfile;

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
  ['all', 'book', 'movie', 'music'].forEach((type) => {
    const count = type === 'all' ? items.length : items.filter((item) => item.type === type).length;
    $(`#${type === 'all' ? 'all' : type}Count`).textContent = count;
  });
  document.querySelectorAll('.filter-chip').forEach((button) => button.classList.toggle('active', button.dataset.filter === activeView));
}

function renderProfile() {
  const favorites = items.filter((item) => item.favorite);
  const recent = [...items].sort((a, b) => Number(b.id) - Number(a.id)).slice(0, 4);
  const displayName = currentUser?.name || 'Your';
  const initials = getInitials(displayName);
  const usernameTag = displayName.toLowerCase().replace(/\s+/g, '');

  $('#breadcrumbView').textContent = 'Profile';
  $('#profileView').innerHTML = `<div class="profile-hero"><div class="profile-avatar">${initials}</div><div class="profile-copy"><p class="eyebrow">PUBLIC PROFILE</p><h1>${displayName}'s shelf</h1><p>Collecting stories, sounds, and scenes worth keeping close.</p><div class="profile-meta"><span>@${usernameTag}</span><span>•</span><span>Chicago, IL</span><span>•</span><span>Member since ${new Date(currentUser?.createdAt || Date.now()).getFullYear()}</span></div></div><button class="outline-button">Share profile <span>↗</span></button></div><div class="profile-stats"><div><strong>${items.length}</strong><span>on shelf</span></div><div><strong>${favorites.length}</strong><span>favorites</span></div><div><strong>0</strong><span>following</span></div><div><strong>0</strong><span>followers</span></div></div><div class="profile-columns"><section><div class="profile-heading"><div><p class="eyebrow">THE SHORTLIST</p><h2>Favorites</h2></div><button class="text-button">See all <span>→</span></button></div><div class="favorite-shelf">${favorites.length ? favorites.map(cardTemplate).join('') : '<div class="empty-state"><strong>Your favorites are waiting.</strong><p>Star the things that define your taste.</p></div>'}</div></section><aside class="activity-panel"><div class="profile-heading"><div><p class="eyebrow">WHAT'S NEW</p><h2>Recent activity</h2></div></div>${recent.map((item) => `<div class="activity-item"><div class="activity-thumb ${item.color}">${typeLabels[item.type][0]}</div><div><p>Added <strong>${item.title}</strong></p><span>${item.creator} · ${typeLabels[item.type]}</span></div><time>${item.year}</time></div>`).join('')}<button class="follow-button">Find people to follow <span>→</span></button></aside></div>`;
}

function cardTemplate(item) {
  const signedIn = Boolean(currentUser);
  const actions = signedIn
    ? `<button class="favorite ${item.favorite ? 'is-favorite' : ''}" data-favorite="${item.id}" aria-label="${item.favorite ? 'Remove from' : 'Add to'} favorites">${item.favorite ? '*' : '+'}</button><button class="remove-card" data-remove="${item.id}" aria-label="Remove ${item.title}">remove</button>`
    : '';

  return `<article class="media-card"><div class="cover ${item.color}"><div class="cover-top"><span class="cover-type">${typeLabels[item.type]} / ${item.year || '—'}</span></div>${actions}<div class="cover-bottom"><div class="cover-title">${item.title}</div><div class="cover-creator">${item.creator}</div></div></div><div class="card-meta"><h3>${item.title}</h3><p>${item.creator}</p></div></article>`;
}

function setView(view) {
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
  $('#modalBackdrop').hidden = false;
  document.querySelector('[name="title"]').focus();
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

  try {
    const response = await fetch('/api/items', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ title, creator, type, year, color })
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
