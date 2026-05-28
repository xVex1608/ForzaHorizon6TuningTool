export type UpdateCheckStatus = 'current' | 'available';

export interface UpdateCheckResult {
  status: UpdateCheckStatus;
  currentVersion: string;
  latestVersion: string;
  releaseName: string;
  releaseUrl: string;
  releaseNotes: string;
  publishedAt: string;
  setupDownloadUrl?: string;
  setupFileName?: string;
  checkedAt: string;
}

interface GitHubReleaseAsset {
  name?: string;
  browser_download_url?: string;
}

interface GitHubRelease {
  tag_name?: string;
  name?: string;
  html_url?: string;
  body?: string;
  published_at?: string;
  assets?: GitHubReleaseAsset[];
}

const RELEASES_URL = 'https://github.com/xVex1608/ForzaHorizon6TuningTool/releases';
const LATEST_RELEASE_URL = 'https://api.github.com/repos/xVex1608/ForzaHorizon6TuningTool/releases/latest';

function normalizeVersion(version: string) {
  return version.trim().replace(/^v/i, '').split(/[+-]/)[0];
}

function compareVersions(left: string, right: string) {
  const leftParts = normalizeVersion(left).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const rightParts = normalizeVersion(right).split('.').map((part) => Number.parseInt(part, 10) || 0);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftValue = leftParts[index] ?? 0;
    const rightValue = rightParts[index] ?? 0;

    if (leftValue > rightValue) return 1;
    if (leftValue < rightValue) return -1;
  }

  return 0;
}

function findSetupAsset(assets: GitHubReleaseAsset[] = []) {
  const asset = assets.find((candidate) => {
    const name = candidate.name?.toLowerCase() ?? '';
    return name.endsWith('.exe') && name.includes('setup');
  });

  if (!asset?.browser_download_url) {
    return null;
  }

  return {
    name: asset.name || 'FH6 TuneLab Setup.exe',
    url: asset.browser_download_url,
  };
}

export async function checkForUpdates(currentVersion: string): Promise<UpdateCheckResult> {
  const response = await fetch(LATEST_RELEASE_URL, {
    headers: {
      Accept: 'application/vnd.github+json',
    },
  });

  if (response.status === 404) {
    return {
      status: 'current',
      currentVersion,
      latestVersion: currentVersion,
      releaseName: 'No public release yet',
      releaseUrl: RELEASES_URL,
      releaseNotes: '',
      publishedAt: '',
      checkedAt: new Date().toISOString(),
    };
  }

  if (!response.ok) {
    throw new Error(`GitHub release check failed (${response.status})`);
  }

  const release = (await response.json()) as GitHubRelease;
  const latestVersion = release.tag_name || release.name || currentVersion;
  const comparison = compareVersions(latestVersion, currentVersion);
  const setupAsset = findSetupAsset(release.assets);

  return {
    status: comparison > 0 ? 'available' : 'current',
    currentVersion,
    latestVersion,
    releaseName: release.name || latestVersion,
    releaseUrl: release.html_url || RELEASES_URL,
    releaseNotes: release.body?.trim() || '',
    publishedAt: release.published_at || '',
    setupDownloadUrl: setupAsset?.url,
    setupFileName: setupAsset?.name,
    checkedAt: new Date().toISOString(),
  };
}
