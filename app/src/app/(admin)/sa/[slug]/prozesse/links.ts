/** Link zur Detailansicht eines Datensatzes (null, wenn es keine eigene Seite gibt). */
export function objectHref(slug: string, objectType: string, objectId: string): string | null {
  const id = encodeURIComponent(objectId);
  switch (objectType) {
    case "contact":
      return `/sa/${slug}/kontakte/${id}`;
    case "company":
      return `/sa/${slug}/unternehmen/${id}`;
    case "ticket":
      return `/sa/${slug}/tickets/${id}`;
    case "deal":
      return `/sa/${slug}/pipeline/${id}`;
    default:
      return null;
  }
}
