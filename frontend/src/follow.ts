const STORAGE_KEY = "bangumi-followed";

function loadFollowed(): Set<string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    return new Set(JSON.parse(raw));
  } catch {
    return new Set();
  }
}

function saveFollowed(set: Set<string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...set]));
}

let followed = loadFollowed();

export function isFollowed(id: string): boolean {
  return followed.has(id);
}

export function toggleFollow(id: string): boolean {
  if (followed.has(id)) {
    followed.delete(id);
  } else {
    followed.add(id);
  }
  saveFollowed(followed);
  return followed.has(id);
}

export function getFollowedIds(): Set<string> {
  return new Set(followed);
}
