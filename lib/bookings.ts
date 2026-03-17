export function getBookingJourneyLabel(input: {
  catalogPackageTitle?: string | null;
  items?: unknown;
  guestDetails?: unknown;
}) {
  if (input.catalogPackageTitle) {
    return input.catalogPackageTitle;
  }

  if (Array.isArray(input.items)) {
    for (const item of input.items) {
      if (item && typeof item === 'object' && 'itemName' in item && typeof item.itemName === 'string' && item.itemName.trim()) {
        return item.itemName.trim();
      }
    }
  }

  if (input.guestDetails && typeof input.guestDetails === 'object' && 'tripTitle' in input.guestDetails) {
    const tripTitle = input.guestDetails.tripTitle;
    if (typeof tripTitle === 'string' && tripTitle.trim()) {
      return tripTitle.trim();
    }
  }

  return 'Manual / mixed booking';
}
