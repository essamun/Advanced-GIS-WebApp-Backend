// Map initialization and base layers
export const map = L.map('map').setView([43.7803, -79.417], 18);

// Add OpenStreetMap base layer
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19
}).addTo(map);

export function initializeMap() {
    setTimeout(() => {
        map.invalidateSize();
        console.log("Map initialized at:", map.getCenter());
    }, 500);
}