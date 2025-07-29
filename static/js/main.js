import { businessIcons } from './components/utils.js';
import { map, initializeMap } from './components/map.js';

// Layer variables
let buildingsLayer, streetsLayer, businessLayer;
let bufferLayer = null;
let highlightedLayer = null;
let lastClickedBusiness = null;
let userMarker = null;
let chartInstance = null;
let currentChartType = 'pie';

// Add these variables at the top with other layer variables
let selectedBusiness = null;

// Add these variables at the top with other variables
let isDragging = false;
let offsetX, offsetY;

// Business filters
const filterBusinessTypes = new Set(['pharmacy', 'restaurant', 'store', 'coffeeshop', 'print_shop', 'bank']);

// Load layers from database
function loadLayers() {
    // Streets layer
    fetch('/api/streets')
        .then(res => res.json())
        .then(data => {
            console.log('Streets data loaded:', data);
            streetsLayer = L.geoJSON(data, {
                style: {
                    color: '#333',
                    weight: 3,
                    opacity: 0.8
                },
                onEachFeature: (feature, layer) => {
                    let popupContent = '<div class="popup-content">';
                    for (const [key, value] of Object.entries(feature.properties)) {
                        popupContent += `<strong>${key}:</strong> ${value}<br>`;
                    }
                    popupContent += '</div>';
                    layer.bindPopup(popupContent);
                }
            });
            
            if (document.getElementById('toggleStreets').checked) {
                streetsLayer.addTo(map);
            }
        })
        .catch(err => console.error('Street layer error:', err));

    // Buildings layer
    fetch('/api/buildings')
        .then(res => res.json())
        .then(data => {
            console.log('Buildings data loaded:', data);
            buildingsLayer = L.geoJSON(data, {
                style: {
                    color: 'blue',
                    weight: 1,
                    fillColor: 'lightblue',
                    fillOpacity: 0.5
                },
                onEachFeature: (feature, layer) => {
                    let popupContent = '<div class="popup-content">';
                    for (const [key, value] of Object.entries(feature.properties)) {
                        popupContent += `<strong>${key}:</strong> ${value}<br>`;
                    }
                    popupContent += '</div>';
                    layer.bindPopup(popupContent);
                }
            });
            
            if (document.getElementById('toggleBuildings').checked) {
                buildingsLayer.addTo(map);
            }
        })
        .catch(err => console.error('Building layer error:', err));

    // Business layer
    loadBusinessLayer();
}

// Business layer functions
function loadBusinessLayer() {
    fetch('/api/business')
        .then(res => res.json())
        .then(data => {
            console.log('Business data loaded:', data);
            if (businessLayer && map.hasLayer(businessLayer)) {
                map.removeLayer(businessLayer);
            }
            
            // Filter features based on active filters
            const filteredFeatures = data.features.filter(feature => {
                const type = feature.properties?.type?.toLowerCase();
                return filterBusinessTypes.has(type);
            });
            
            // Count business types for chart
            const businessCounts = {};
            filteredFeatures.forEach(feature => {
                const type = feature.properties?.type?.toLowerCase() || 'default';
                businessCounts[type] = (businessCounts[type] || 0) + 1;
            });
            
            // Create business layer with markers
            businessLayer = L.geoJSON(filteredFeatures, {
                pointToLayer: (feature, latlng) => {
                    const type = feature.properties?.type?.toLowerCase() || 'default';
                    const icon = businessIcons[type] || businessIcons.default;
                    return L.marker(latlng, { 
                        icon: icon,
                        title: feature.properties?.name || "Business"
                    });
                },

                onEachFeature: (feature, layer) => {
                    const name = feature.properties?.name || "Business";
                    const type = feature.properties?.type || "Unknown";
                    layer.bindPopup(`<strong>${name}</strong><br>Type: ${type}`);
                    
                    layer.on('click', function(e) {
                        // If Ctrl key is pressed, do buffer analysis
                        if (e.originalEvent.ctrlKey || e.originalEvent.metaKey) {
                            if (lastClickedBusiness === layer) {
                                clearBufferAnalysis();
                                return;
                            }
                            performBufferAnalysis(layer);
                            return;
                        }
                        
                        // Otherwise, select the business
                        if (selectedBusiness) {
                            const prevType = selectedBusiness.feature.properties.type.toLowerCase();
                            selectedBusiness.setIcon(businessIcons[prevType] || businessIcons.default);
                        }
                        
                        selectedBusiness = layer;
                        layer.setIcon(businessIcons.highlighted);
                    });
                }
            });
            
            if (document.getElementById('toggleBusinesses').checked) {
                businessLayer.addTo(map);
            }
            
            drawBusinessChart(businessCounts);
        })
        .catch(err => console.error('Business layer error:', err));
}

// Buffer analysis functions
function clearBufferAnalysis() {
    if (bufferLayer) {
        map.removeLayer(bufferLayer);
        bufferLayer = null;
    }
    if (highlightedLayer) {
        map.removeLayer(highlightedLayer);
        highlightedLayer = null;
    }
    if (lastClickedBusiness) {
        const type = lastClickedBusiness.feature.properties?.type?.toLowerCase() || 'default';
        const icon = businessIcons[type] || businessIcons.default;
        lastClickedBusiness.setIcon(icon);
        
        const name = lastClickedBusiness.feature.properties?.name || "Business";
        const typeName = lastClickedBusiness.feature.properties?.type || "Unknown";
        lastClickedBusiness.setPopupContent(`<strong>${name}</strong><br>Type: ${typeName}`);
        
        lastClickedBusiness = null;
    }
}

function performBufferAnalysis(layer) {
    clearBufferAnalysis();
    
    const clickedPoint = turf.point([layer.getLatLng().lng, layer.getLatLng().lat]);
    const buffer = turf.buffer(clickedPoint, 0.05, { units: 'kilometers' });

    bufferLayer = L.geoJSON(buffer, {
        style: {
            color: '#3388ff',
            weight: 2,
            fillColor: '#3388ff',
            fillOpacity: 0.2
        }
    }).addTo(map);

    const nearbyFeatures = [];
    businessLayer.eachLayer(biz => {
        if (biz !== layer && biz.getLatLng) {
            const bizPoint = turf.point([biz.getLatLng().lng, biz.getLatLng().lat]);
            if (turf.booleanPointInPolygon(bizPoint, buffer)) {
                nearbyFeatures.push(biz.feature);
            }
        }
    });

    highlightedLayer = L.geoJSON({
        type: "FeatureCollection",
        features: nearbyFeatures
    }, {
        pointToLayer: (feature, latlng) => {
            return L.circleMarker(latlng, {
                radius: 8,
                color: '#ff7800',
                weight: 1,
                fillColor: '#ffd42a',
                fillOpacity: 0.8,
                className: 'highlighted-business'
            });
        },
        onEachFeature: (feature, layer) => {
            const name = feature.properties?.name || "Nearby Business";
            const type = feature.properties?.type || "Unknown";
            layer.bindPopup(`<strong>${name}</strong><br>Type: ${type}<br><em>Within 50m radius</em>`);
        }
    }).addTo(map);

    layer.setIcon(businessIcons.highlighted);
    const name = layer.feature.properties?.name || "Business";
    const type = layer.feature.properties?.type || "Unknown";
    layer.setPopupContent(`
        <strong>${name}</strong><br>
        Type: ${type}<br>
        <strong>${nearbyFeatures.length}</strong> nearby businesses within 50m
        <div style="font-size: smaller; color: #666;">Click again to clear</div>
    `);
    layer.openPopup();
    
    lastClickedBusiness = layer;
}

// Chart functions
function drawBusinessChart(businessCounts) {
    const ctx = document.getElementById('business-chart');
    if (!ctx) {
        console.error('Chart canvas not found');
        return;
    }

    if (chartInstance) {
        chartInstance.destroy();
    }

    const labels = Object.keys(businessCounts).map(type => 
        type.charAt(0).toUpperCase() + type.slice(1).replace('_', ' '));
    const values = Object.values(businessCounts);
    
    const colors = [
        '#4CAF50', '#2196F3', '#FFC107', '#FF5722', 
        '#9C27B0', '#607D8B', '#00BCD4', '#8BC34A'
    ];

    const commonConfig = {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            tooltip: {
                callbacks: {
                    label: function(context) {
                        const label = context.label || '';
                        const value = context.raw || 0;
                        const total = context.dataset.data.reduce((a, b) => a + b, 0);
                        const percentage = Math.round((value / total) * 100);
                        return `${label}: ${value} (${percentage}%)`;
                    }
                }
            }
        }
    };

    const config = {
        type: currentChartType,
        data: {
            labels: labels,
            datasets: [{
                data: values,
                backgroundColor: colors,
                borderWidth: 1
            }]
        },
        options: {
            ...commonConfig,
            plugins: {
                ...commonConfig.plugins,
                legend: {
                    display: currentChartType === 'pie',
                    position: 'right',
                    labels: {
                        boxWidth: 12,
                        padding: 10,
                        usePointStyle: true
                    }
                }
            }
        }
    };

    if (currentChartType === 'bar') {
        config.options.indexAxis = 'y';
        config.options.scales = {
            x: {
                beginAtZero: true,
                ticks: {
                    precision: 0,
                    stepSize: 1
                }
            }
        };
    }

    chartInstance = new Chart(ctx, config);

    const toggleBtn = document.getElementById('toggleChartType');
    if (toggleBtn) {
        toggleBtn.textContent = currentChartType === 'pie' 
            ? '🔄 Switch to Bar Chart' 
            : '🔄 Switch to Pie Chart';
    }
}


// Add these functions to handle business management
function showBusinessModal(mode, business = null) {
    const modal = document.getElementById('businessModal');
    const title = document.getElementById('modalTitle');
    const form = document.getElementById('businessForm');
    const idField = document.getElementById('businessId');
    const nameField = document.getElementById('businessName');
    const typeField = document.getElementById('businessType');
    const latField = document.getElementById('businessLat');
    const lngField = document.getElementById('businessLng');
    const locationFields = document.getElementById('locationFields');
    
    // Reset form
    form.reset();
    idField.value = '';
    
    // Position modal in center but slightly offset
    const centerX = window.innerWidth / 2 - 150; // 150 is half modal width
    const centerY = window.innerHeight / 3; // Position at 1/3 from top
    modal.style.left = `${centerX}px`;
    modal.style.top = `${centerY}px`;
    
    // Set mode (add or edit)
    if (mode === 'add') {
        title.textContent = 'Add New Business';
        locationFields.style.display = 'block';
        
        // Set default location to map center
        const center = map.getCenter();
        latField.value = center.lat.toFixed(6);
        lngField.value = center.lng.toFixed(6);
        
        // Add click handler to update location
        const clickHandler = e => {
            latField.value = e.latlng.lat.toFixed(6);
            lngField.value = e.latlng.lng.toFixed(6);
        };
        
        map.on('click', clickHandler);
        
        // Remove click handler when modal closes
        modal.dataset.clickHandler = clickHandler;
    } else if (mode === 'edit' && business) {
        title.textContent = 'Edit Business';
        locationFields.style.display = 'none';
        
        // Fill form with business data
        const props = business.feature.properties;
        const coords = business.getLatLng();
        
        idField.value = props.ogc_fid;
        nameField.value = props.name;
        typeField.value = props.type;
        latField.value = coords.lat;
        lngField.value = coords.lng;
    }
    
    // Show modal
    modal.style.display = 'block';
}

function hideBusinessModal() {
    const modal = document.getElementById('businessModal');
    modal.style.display = 'none';
    
    // Remove any map click handler
    if (modal.dataset.clickHandler) {
        map.off('click', modal.dataset.clickHandler);
        delete modal.dataset.clickHandler;
    }
}

async function saveBusiness(e) {
    e.preventDefault();
    
    const form = document.getElementById('businessForm');
    const id = document.getElementById('businessId').value;
    const name = document.getElementById('businessName').value;
    const type = document.getElementById('businessType').value;
    const lat = document.getElementById('businessLat').value;
    const lng = document.getElementById('businessLng').value;
    
    try {
        let url, method;
        
        if (id) {
            // Update existing business
            url = `/api/business/update/${id}`;
            method = 'PUT';
        } else {
            // Add new business
            url = '/api/business/add';
            method = 'POST';
        }
        
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: name,
                type: type,
                lat: parseFloat(lat),
                lng: parseFloat(lng)
            })
        });
        
        if (!response.ok) {
            throw new Error(await response.text());
        }
        
        const business = await response.json();
        
        // Reload the business layer to show changes
        loadBusinessLayer();
        hideBusinessModal();
        
        // If this was an edit, deselect the business
        if (id && selectedBusiness) {
            const bizType = selectedBusiness.feature.properties.type.toLowerCase();
            selectedBusiness.setIcon(businessIcons[bizType] || businessIcons.default);
            selectedBusiness = null;
        }
        
    } catch (err) {
        console.error('Error saving business:', err);
        alert('Error saving business: ' + err.message);
    }
}

function deleteSelectedBusiness() {
    if (!selectedBusiness) {
        alert('Please select a business first by clicking on it');
        return;
    }
    
    const businessId = selectedBusiness.feature.properties.ogc_fid;
    const businessName = selectedBusiness.feature.properties.name;
    
    if (!confirm(`Are you sure you want to delete "${businessName}"?`)) {
        return;
    }
    
    fetch(`/api/business/delete/${businessId}`, {
        method: 'DELETE'
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Failed to delete business');
        }
        return response.json();
    })
    .then(() => {
        // Reload the business layer
        loadBusinessLayer();
        selectedBusiness = null;
    })
    .catch(err => {
        console.error('Error deleting business:', err);
        alert('Error deleting business: ' + err.message);
    });
}


// Add this function to handle drag functionality
function makeModalDraggable() {
    const modal = document.getElementById('businessModal');
    const header = document.getElementById('modalHeader');
    
    header.addEventListener('mousedown', (e) => {
        isDragging = true;
        
        // Get the mouse position relative to the modal
        const rect = modal.getBoundingClientRect();
        offsetX = e.clientX - rect.left;
        offsetY = e.clientY - rect.top;
        
        // Change cursor and prevent text selection
        document.body.style.cursor = 'grabbing';
        document.body.style.userSelect = 'none';
    });
    
    document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        
        // Calculate new position
        const x = e.clientX - offsetX;
        const y = e.clientY - offsetY;
        
        // Apply new position
        modal.style.left = `${x}px`;
        modal.style.top = `${y}px`;
    });
    
    document.addEventListener('mouseup', () => {
        isDragging = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
    });
}


// Event listeners
function setupEventListeners() {
    document.getElementById('toggleStreets').addEventListener('change', e => {
        e.target.checked ? streetsLayer.addTo(map) : map.removeLayer(streetsLayer);
    });

    document.getElementById('toggleBuildings').addEventListener('change', e => {
        e.target.checked ? buildingsLayer.addTo(map) : map.removeLayer(buildingsLayer);
    });

    document.getElementById('toggleBusinesses').addEventListener('change', e => {
        if (e.target.checked) {
            if (businessLayer && !map.hasLayer(businessLayer)) {
                businessLayer.addTo(map);
            }
        } else {
            if (businessLayer && map.hasLayer(businessLayer)) {
                map.removeLayer(businessLayer);
            }
            clearBufferAnalysis();
        }
    });

    document.querySelectorAll('.biz-filter').forEach(checkbox => {
        checkbox.addEventListener('change', () => {
            const type = checkbox.dataset.type.toLowerCase();
            checkbox.checked ? filterBusinessTypes.add(type) : filterBusinessTypes.delete(type);
            loadBusinessLayer();
            clearBufferAnalysis();
        });
    });

    document.getElementById('btnNearest').addEventListener('click', () => {
        if (!businessLayer || !document.getElementById('toggleBusinesses').checked) {
            alert('Please enable businesses layer first!');
            return;
        }

        alert('Please click on the map to specify your current location');
        
        if (userMarker) {
            map.removeLayer(userMarker);
            userMarker = null;
        }
        
        clearBufferAnalysis();
        
        const userClickHandler = map.on('click', (e) => {
            if (userMarker) map.removeLayer(userMarker);
            
            userMarker = L.marker(e.latlng, {
                icon: L.divIcon({
                    className: 'user-location-icon',
                    html: '📍',
                    iconSize: [32, 32],
                    iconAnchor: [16, 32]
                })
            }).addTo(map);
            
            userMarker.bindPopup('Your location').openPopup();
            
            let nearestBusiness = null;
            let minDistance = Infinity;
            
            businessLayer.eachLayer(layer => {
                if (layer instanceof L.Marker) {
                    const distance = e.latlng.distanceTo(layer.getLatLng());
                    if (distance < minDistance) {
                        minDistance = distance;
                        nearestBusiness = layer;
                    }
                }
            });
            
            if (nearestBusiness) {
                nearestBusiness.setIcon(businessIcons.highlighted);
                
                const name = nearestBusiness.feature.properties?.name || "Business";
                const type = nearestBusiness.feature.properties?.type || "Unknown";
                nearestBusiness.setPopupContent(
                    `<strong>${name}</strong><br>
                     Type: ${type}<br>
                     <strong>Distance:</strong> ${Math.round(minDistance)}m (${(minDistance/1000).toFixed(2)}km)<br>
                     <em>Nearest to your location</em>`
                );
                nearestBusiness.openPopup();
                map.setView(nearestBusiness.getLatLng(), 18);
            }
            
            map.off('click', userClickHandler);
        });
    });

    document.getElementById('btnClearBuffer').addEventListener('click', clearBufferAnalysis);

    document.getElementById('toggleChartType').addEventListener('click', function() {
        currentChartType = currentChartType === 'pie' ? 'bar' : 'pie';
        loadBusinessLayer(); // Reload to redraw chart
    });

     // Business management
    document.getElementById('btnAddBusiness').addEventListener('click', () => {
        showBusinessModal('add');
    });
    
    document.getElementById('btnEditBusiness').addEventListener('click', () => {
        if (!selectedBusiness) {
            alert('Please select a business first by clicking on it');
            return;
        }
        showBusinessModal('edit', selectedBusiness);
    });
    
    document.getElementById('btnDeleteBusiness').addEventListener('click', deleteSelectedBusiness);
    
    document.getElementById('btnCancel').addEventListener('click', hideBusinessModal);
    document.getElementById('businessForm').addEventListener('submit', saveBusiness);

     // Add click handler to business layer to select businesses
    if (businessLayer) {
        businessLayer.eachLayer(layer => {
            layer.on('click', function(e) {
                // Deselect previous selection
                if (selectedBusiness) {
                    const prevType = selectedBusiness.feature.properties.type.toLowerCase();
                    selectedBusiness.setIcon(businessIcons[prevType] || businessIcons.default);
                }
                
                // Select new business
                selectedBusiness = layer;
                layer.setIcon(businessIcons.highlighted);
            });
        });
    }

}

// Initialize the app
function init() {
    loadLayers();
    setupEventListeners();
    makeModalDraggable(); // Add this line
    initializeMap(); // Changed from setTimeout() to use the exported function
}

init();