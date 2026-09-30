// plugins/fanout/index.js
//
// After a successful production deploy of the main site, rebuild each subsite —
// but only when the files those subsites pull from this repo actually changed.
//
// Netlify UI → Site configuration → Environment variables (scope: Builds):
//   SUBSITE_HOOK_<NAME>   one per subsite, value = that site's build hook URL
//   DRY_RUN               set to any non-empty value to log decisions without
//                         firing hooks ("false" counts as set)

import { execFileSync } from 'node:child_process';

// Subsites extend es_config/ over raw.githubusercontent.com and curl
// build-docs.sh during their own Netlify builds, so a change to either has to
// propagate outward.
const WATCHED = ['es_config/**', 'scripts/build-docs.sh'];
// Same paths as plain git pathspecs (directories match recursively).
const WATCHED_PATHSPECS = WATCHED.map((p) => p.replace(/\/\*\*$/, ''));
const PREFIX = 'SUBSITE_HOOK_';
const HOOK_TIMEOUT_MS = 10_000;

export const onSuccess = async ({ utils, constants }) => {
  const { CONTEXT, COMMIT_REF, CACHED_COMMIT_REF, DRY_RUN } = process.env;

  // Branch and deploy-preview builds must never trigger production rebuilds.
  if (CONTEXT !== 'production') {
    console.log(`context is "${CONTEXT}" — skipping fan-out`);
    return;
  }

  const hooks = collectHooks();
  if (hooks.length === 0) {
    console.log(`no ${PREFIX}* variables set — nothing to trigger`);
    return;
  }

  if (!(await sharedFilesChanged(utils, constants, CACHED_COMMIT_REF, COMMIT_REF))) {
    console.log('shared files unchanged — skipping fan-out');
    return;
  }

  console.log(`shared files changed — triggering ${hooks.length} subsite(s)`);

  const failures = [];
  let ok = 0;

  for (const { name, url } of hooks) {
    if (DRY_RUN) {
      console.log(`[dry run] would trigger ${name}`);
      continue;
    }
    try {
      const res = await fetch(
        `${url}?trigger_title=upstream+config+change&clear_cache=true`,
        { method: 'POST', signal: AbortSignal.timeout(HOOK_TIMEOUT_MS) },
      );
      if (res.ok) {
        ok++;
        console.log(`triggered ${name}`);
      } else {
        failures.push(`${name}: ${res.status} ${res.statusText}`);
      }
    } catch (err) {
      failures.push(`${name}: ${err.message}`);
    }
  }

  if (DRY_RUN) return;

  for (const failure of failures) console.warn(failure);
  console.log(`${ok}/${hooks.length} subsite builds triggered`);

  // onSuccess is a soft-fail event, so failBuild would only warn. The deploy
  // summary is the one place a partial fan-out is visible without reading logs.
  const status = {
    title: 'Subsite fan-out',
    summary: `${ok}/${hooks.length} subsite builds triggered`,
  };
  if (failures.length > 0) status.text = `Failed:\n${failures.join('\n')}`;
  utils.status.show(status);
};

// One env var per subsite: SUBSITE_HOOK_GEOLAB, SUBSITE_HOOK_USAGE_STATS, …
function collectHooks() {
  return Object.entries(process.env)
    .filter(([key, val]) => key.startsWith(PREFIX) && val && val.trim())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => ({
      name: key.slice(PREFIX.length).toLowerCase(),
      url: val.trim(),
    }));
}

// Commit of the most recent successful production deploy other than this one,
// or null if it can't be determined.
async function lastDeployedCommit({ siteId, token, deployId }) {
  if (!siteId || !token) {
    console.warn('no Netlify site ID or API token — cannot look up last deploy');
    return null;
  }
  try {
    const res = await fetch(
      `https://api.netlify.com/api/v1/sites/${siteId}/deploys?production=true&state=ready&per_page=10`,
      {
        headers: { Authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(HOOK_TIMEOUT_MS),
      },
    );
    if (!res.ok) {
      console.warn(`deploy lookup failed: ${res.status} ${res.statusText}`);
      return null;
    }
    const deploys = await res.json();
    // The current deploy is already ready by the time onSuccess runs.
    const prev = deploys.find((d) => d.id !== deployId && d.commit_ref);
    return prev ? prev.commit_ref : null;
  } catch (err) {
    console.warn(`deploy lookup failed: ${err.message}`);
    return null;
  }
}

// True if any WATCHED path changed since the last successful production deploy,
// falling back to the build cache, then to the built commit alone. Failure
// paths return true: an extra rebuild is cheap, a missed one leaves subsites
// rendering a stale nav with no visible error anywhere.
async function sharedFilesChanged(utils, constants, cached, current) {
  const base = await lastDeployedCommit({
    siteId: constants.SITE_ID,
    token: constants.NETLIFY_API_TOKEN,
    deployId: process.env.DEPLOY_ID,
  });
  if (base) {
    console.log(`comparing against last deploy ${base.slice(0, 7)}`);
    // Same commit as the last deploy means a retry, not new content.
    if (base === current) return false;
    return rangeTouchesWatched(base, current);
  }

  // Netlify sets CACHED_COMMIT_REF = COMMIT_REF when building without cache, so
  // there is no baseline. Fall back to what this commit itself changed, which
  // still skips a retry of a commit that didn't touch shared files.
  if (!cached || cached === current) {
    console.log('comparing against parent of built commit');
    return rangeTouchesWatched(`${current}^`, current);
  }
  console.log(`comparing against cached build ${cached.slice(0, 7)}`);
  try {
    // utils.git already diffs against CACHED_COMMIT_REF. `edited` omits
    // deletions, so check each bucket instead.
    const { modified, created, deleted } = utils.git.fileMatch(...WATCHED);
    return modified.length + created.length + deleted.length > 0;
  } catch (err) {
    console.warn(`git comparison failed (${err.message}) — triggering anyway`);
    return true;
  }
}

// True if any WATCHED path differs between `from` and `to`. Only trees are
// needed, so this works in Netlify's blobless clone.
function rangeTouchesWatched(from, to) {
  if (!to) return true;
  try {
    const out = execFileSync(
      'git',
      ['diff', '--name-only', from, to, '--', ...WATCHED_PATHSPECS],
      { encoding: 'utf8' },
    );
    return out.trim().length > 0;
  } catch (err) {
    console.warn(`git comparison failed (${err.message}) — triggering anyway`);
    return true;
  }
}

