<script lang="ts">
  import '../app.css';
  import { onMount, type Snippet } from 'svelte';
  import { page } from '$app/state';
  import { api, errorMessage } from '$lib/api';
  import type { PublicUser } from '@rabbithole/shared';

  let { children }: { children: Snippet } = $props();

  let user = $state<PublicUser | null>(null);
  let loaded = $state(false);
  let email = $state('');
  let password = $state('');
  let error = $state<string | null>(null);

  const NAV = [
    ['/', 'Tableau de bord'],
    ['/candidates', 'Candidats'],
    ['/cards', 'Cartes'],
    ['/series', 'Séries'],
    ['/moderation', 'Modération'],
    ['/countries', 'Pays'],
    ['/trending', 'Tendances'],
    ['/balance', 'Équilibrage'],
    ['/audit', 'Journal'],
  ] as const;

  onMount(async () => {
    user = (await api.session().catch(() => ({ user: null }))).user;
    loaded = true;
  });

  async function login(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    error = null;
    try {
      user = (await api.login(email, password)).user;
    } catch (err) {
      error = errorMessage(err);
    }
  }

  async function logout(): Promise<void> {
    await api.logout();
    user = null;
  }

  const active = (href: string) => (href === '/' ? page.url.pathname === '/' : page.url.pathname.startsWith(href));
</script>

{#if !loaded}
  <p class="center muted">Chargement…</p>
{:else if !user || user.role !== 'admin'}
  <form class="login panel" onsubmit={login}>
    <h1>RABBIT HOLE · Admin</h1>
    {#if user}
      <p class="error">Ce compte ({user.email}) n'est pas administrateur. Les admins sont listés dans <code>ADMIN_EMAILS</code>.</p>
      <button type="button" onclick={logout}>Se déconnecter</button>
    {:else}
      <label>E-mail <input type="email" required bind:value={email} data-testid="admin-email" /></label>
      <label>Mot de passe <input type="password" required bind:value={password} data-testid="admin-password" /></label>
      {#if error}<p class="error">{error}</p>{/if}
      <button class="primary" type="submit" data-testid="admin-login">Connexion</button>
    {/if}
  </form>
{:else}
  <div class="shell">
    <nav>
      <strong class="brand">RABBIT HOLE</strong>
      <span class="muted">Admin</span>
      {#each NAV as [href, label] (href)}
        <a {href} class:active={active(href)}>{label}</a>
      {/each}
      <span class="grow"></span>
      <span class="muted">{user.displayName}</span>
      <button onclick={logout}>Déconnexion</button>
    </nav>
    <main>{@render children()}</main>
  </div>
{/if}

<style>
  .center {
    text-align: center;
    margin-top: 20vh;
  }
  .login {
    width: min(380px, 92vw);
    margin: 14vh auto;
    display: grid;
    gap: 12px;
  }
  .login label {
    display: grid;
    gap: 4px;
    color: var(--muted);
  }
  .shell {
    min-height: 100vh;
  }
  nav {
    position: sticky;
    top: 0;
    z-index: 5;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 10px 20px;
    background: var(--bg-2);
    border-bottom: 1px solid var(--line);
  }
  nav a {
    color: var(--muted);
    text-decoration: none;
    font-weight: 600;
  }
  nav a.active {
    color: var(--text);
    border-bottom: 2px solid var(--accent);
  }
  .brand {
    letter-spacing: 0.08em;
  }
  .grow {
    flex: 1;
  }
  main {
    padding: 20px;
    max-width: 1500px;
    margin: 0 auto;
  }
</style>
