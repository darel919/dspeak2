function publicationIdentity(publication) {
  const peerId = String(publication?.peerId || "");
  const source = String(publication?.source || "");
  return peerId && source ? `${peerId}:${source}` : null;
}

export function createCloudflarePublicationRegistry() {
  const publications = new Map();

  function update(publication) {
    const trackName = String(publication?.trackName || "");
    if (!trackName) return false;
    if (publication.closed === true) {
      publications.delete(trackName);
      return true;
    }
    const identity = publicationIdentity(publication);
    for (const [currentTrackName, current] of publications) {
      if (
        currentTrackName === trackName ||
        (identity && publicationIdentity(current) === identity)
      )
        publications.delete(currentTrackName);
    }
    publications.set(trackName, publication);
    return true;
  }

  return {
    clear: () => publications.clear(),
    update,
    values: () => [...publications.values()],
  };
}
