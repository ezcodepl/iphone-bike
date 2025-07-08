// Inicjalizacja mapy Leaflet
const map = L.map('map').setView([54.1865, 16.2410], 13); // Domyślne współrzędne (Koszalin) i zoom

// Dodanie warstwy OpenStreetMap
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

let currentTrackLayer = null; // Warstwa dla całej trasy
let startMarker = null;       // Marker dla startu
let endMarker = null;         // Marker dla mety
let bikeMarker = null;        // Marker dla roweru (animowany)
let animationInterval = null; // Zmienna do przechowywania interwału animacji
let animationIndex = 0;       // Indeks bieżącego punktu animacji
let processedPoints = [];     // Punkty trasy po przetworzeniu i filtrowaniu

const gpxFileInput = document.getElementById('gpx-file-input');
const fileNameSpan = document.getElementById('file-name');
const totalPointsSpan = document.getElementById('total-points');
const filteredPointsSpan = document.getElementById('filtered-points');
const displayDistanceSpan = document.getElementById('display-distance');
const displaySpeedSpan = document.getElementById('display-speed');

// Przyciski sterujące
const startButton = document.getElementById('start-button');
const pauseButton = document.getElementById('pause-button');
const fasterButton = document.getElementById('faster-button');
const slowerButton = document.getElementById('slower-button');
const resetButton = document.getElementById('reset-button');

// Ikona roweru
const bikeIcon = L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/3676/3676644.png', // Przykładowa ikona roweru
    iconSize: [32, 32],
    iconAnchor: [16, 32] // Punkt zakotwiczenia ikony
});

// Dodaj definicje ikon dla startu i mety
const startIcon = L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/1030/1030097.png', // Przykładowa ikona zielonej flagi startowej
    iconSize: [32, 32],
    iconAnchor: [16, 32] 
});

const endIcon = L.icon({
    iconUrl: 'https://cdn-icons-png.flaticon.com/512/1030/1030098.png', // Przykładowa ikona czerwonej flagi mety
    iconSize: [32, 32],
    iconAnchor: [16, 32]
});


// Zmienne dla kontroli prędkości animacji
const speedMultipliers = [1, 2, 4, 8]; // Dostępne mnożniki prędkości: x1, x2, x4, x8
let currentSpeedMultiplierIndex = 0; // Indeks obecnego mnożnika w tablicy
let animationSpeedMultiplier = speedMultipliers[currentSpeedMultiplierIndex]; // Bieżący mnożnik

// Zmienne dla kontroli grubości linii
const BASE_LINE_WEIGHT = 1; // Bazowa grubość linii dla domyślnego zoomu (np. zoom 13) - zmieniona na 1
const ZOOM_WEIGHT_FACTOR = 0.3; // Współczynnik, jak grubość zmienia się z zoomem (zwiększony na 0.3)


// Funkcja do aktualizacji stanu przycisków
function updateButtonStates(trackLoaded = false, isPlaying = false) {
    if (trackLoaded) {
        startButton.classList.remove('disabled');
        resetButton.classList.remove('disabled');
        fasterButton.classList.remove('disabled');
        slowerButton.classList.remove('disabled');
        
        // Resetuj tekst przycisku "Szybciej" i mnożnik do wartości domyślnej
        currentSpeedMultiplierIndex = 0;
        animationSpeedMultiplier = speedMultipliers[currentSpeedMultiplierIndex];
        fasterButton.textContent = '≫ Szybciej'; 

        if (isPlaying) {
            startButton.classList.add('disabled');
            pauseButton.classList.remove('disabled');
        } else {
            startButton.classList.remove('disabled');
            pauseButton.classList.add('disabled');
        }
    } else {
        startButton.classList.add('disabled');
        pauseButton.classList.add('disabled');
        fasterButton.classList.add('disabled');
        slowerButton.classList.add('disabled');
        resetButton.classList.add('disabled');
        
        // Resetuj tekst przycisku i mnożnik, gdy nie ma trasy
        currentSpeedMultiplierIndex = 0;
        animationSpeedMultiplier = speedMultipliers[currentSpeedMultiplierIndex];
        fasterButton.textContent = '≫ Szybciej';
    }
}

// Obsługa wyboru pliku GPX
gpxFileInput.addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) {
        fileNameSpan.textContent = file.name;
        const reader = new FileReader();

        reader.onload = (e) => {
            try {
                // Resetowanie stanu mapy i animacji
                resetMap();

                const parser = new DOMParser();
                const xmlDoc = parser.parseFromString(e.target.result, "text/xml");

                const errorNode = xmlDoc.querySelector('parsererror');
                if (errorNode) {
                    console.error('Błąd parsowania XML:', errorNode.textContent);
                    alert('Błąd parsowania pliku GPX. Sprawdź format pliku.');
                    updateButtonStates(false);
                    return;
                }

                const rawTrackPoints = xmlDoc.querySelectorAll('trkpt');
                processedPoints = []; // Resetuj globalną tablicę punktów

                rawTrackPoints.forEach(point => {
                    const lat = parseFloat(point.getAttribute('lat'));
                    const lon = parseFloat(point.getAttribute('lon'));
                    const ele = parseFloat(point.querySelector('ele')?.textContent || '0');
                    const time = point.querySelector('time')?.textContent;

                    const speedElement = point.querySelector('extensions speed');
                    const speed = speedElement ? parseFloat(speedElement.textContent) : 0;

                    processedPoints.push({ lat, lon, ele, time, speed });
                });

                totalPointsSpan.textContent = `Całkowita liczba punktów: ${processedPoints.length}`;

                // Narysuj statyczną trasę, markery start/meta i przygotuj animację
                drawStaticTrackAndMarkers(processedPoints);
                updateButtonStates(true, false); // Trasa załadowana, ale nie odtwarzana

            } catch (error) {
                console.error('Błąd parsowania GPX:', error);
                alert('Wystąpił błąd podczas przetwarzania pliku GPX. ' + error.message);
                updateButtonStates(false);
            }
        };

        reader.readAsText(file);
    } else {
        fileNameSpan.textContent = 'Nie wybrano pliku';
        resetMap();
        updateButtonStates(false);
    }
});

// Funkcja rysująca statyczną trasę i markery start/meta
function drawStaticTrackAndMarkers(points) {
    if (points.length === 0) {
        alert('Brak punktów w pliku GPX do narysowania.');
        filteredPointsSpan.textContent = 'Liczba punktów po filtrowaniu (prędkość > 0.01 m/s): 0';
        return;
    }

    const latLngsForLine = [];
    let filteredCount = 0;

    points.forEach(point => {
        if (point.speed > 0.01) { // Próg 0.01 m/s (0.036 km/h)
            latLngsForLine.push([point.lat, point.lon]);
            filteredCount++;
        }
    });

    filteredPointsSpan.textContent = `Liczba punktów po filtrowaniu (prędkość > 0.01 m/s): ${filteredCount}`;

    if (latLngsForLine.length === 0) {
        alert('Brak punktów o prędkości większej niż 0.01 m/s do narysowania linii trasy.');
        return;
    }

    // Narysuj linię trasy z domyślną wagą, która zostanie dostosowana przez updateTrackLineWeight().
    currentTrackLayer = L.polyline(latLngsForLine, { color: 'blue', weight: BASE_LINE_WEIGHT, opacity: 0.7 }).addTo(map);
    map.fitBounds(currentTrackLayer.getBounds());

    // Wywołaj funkcję dostosowującą wagę linii po jej utworzeniu
    updateTrackLineWeight();

    points.forEach(point => {
        const marker = L.circleMarker([point.lat, point.lon], {
            radius: 4,
            color: 'red',
            fillColor: '#f03',
            fillOpacity: 0.5
        }).addTo(map);

        const tooltipContent = `
            Latitude: ${point.lat.toFixed(6)}<br>
            Longitude: ${point.lon.toFixed(6)}<br>
            Elevation: ${point.ele.toFixed(2)} m<br>
            Time: ${new Date(point.time).toLocaleTimeString()}<br>
            Speed: ${point.speed.toFixed(2)} m/s
        `;
        marker.bindTooltip(tooltipContent);
    });

    // Użyj nowych ikon dla startu i mety
    const startPoint = points[0];
    if (startPoint) {
        startMarker = L.marker([startPoint.lat, startPoint.lon], { icon: startIcon }).addTo(map)
            .bindPopup('Start').openPopup();
    }

    const endPoint = points[points.length - 1];
    if (endPoint && points.length > 1) { // Upewnij się, że jest co najmniej dwa punkty, aby meta miała sens
        endMarker = L.marker([endPoint.lat, endPoint.lon], { icon: endIcon }).addTo(map)
            .bindPopup('Meta').openPopup();
    }

    if (startPoint) {
        bikeMarker = L.marker([startPoint.lat, startPoint.lon], { icon: bikeIcon }).addTo(map);
        animationIndex = 0; // Ustaw indeks początkowy dla animacji
        displayDistanceSpan.textContent = 'Dystans: 0.00 km';
        displaySpeedSpan.textContent = 'Prędkość: 0.0 km/h';
    }
}

// Funkcja do dynamicznej zmiany grubości linii
function updateTrackLineWeight() {
    if (currentTrackLayer) {
        const currentZoom = map.getZoom();
        // Logika dostosowania wagi linii w zależności od zoomu
        // Im większy zoom (bliżej), tym większa waga (grubsza linia)
        // Domyślny zoom mapy w setView to 13.
        // newWeight = BASE_LINE_WEIGHT (na zoomie 13) + (różnica zoomu * współczynnik)
        let newWeight = BASE_LINE_WEIGHT + (currentZoom - 13) * ZOOM_WEIGHT_FACTOR;
        
        // Ogranicz wagę, aby nie była zbyt cienka ani zbyt gruba
        newWeight = Math.max(0.2, newWeight); // Minimalna grubość - zmniejszono na 0.2
        newWeight = Math.min(8, newWeight); // Maksymalna grubość (możesz dostosować)
        
        currentTrackLayer.setStyle({ weight: newWeight });
    }
}

// Dodaj słuchacza zdarzeń zoomend do mapy
map.on('zoomend', updateTrackLineWeight);


// --- Funkcje sterowania animacją ---

startButton.addEventListener('click', () => {
    if (processedPoints.length > 0 && !startButton.classList.contains('disabled')) {
        startAnimation();
        updateButtonStates(true, true);
    }
});

pauseButton.addEventListener('click', () => {
    if (animationInterval) {
        clearInterval(animationInterval);
        animationInterval = null;
        updateButtonStates(true, false);
    }
});

// Obsługa przycisku "Szybciej" (x2, x4, x8)
fasterButton.addEventListener('click', () => {
    if (!fasterButton.classList.contains('disabled')) {
        currentSpeedMultiplierIndex = (currentSpeedMultiplierIndex + 1) % speedMultipliers.length;
        animationSpeedMultiplier = speedMultipliers[currentSpeedMultiplierIndex];

        // Zaktualizuj tekst przycisku
        if (animationSpeedMultiplier === 1) {
            fasterButton.textContent = '≫ Szybciej';
        } else {
            fasterButton.textContent = `≫ x${animationSpeedMultiplier}`;
        }
        
        console.log("Prędkość animacji: " + animationSpeedMultiplier + "x");
        if (animationInterval) { // Jeśli animacja jest w toku, zrestartuj ją z nową prędkością
            startAnimation();
        }
    }
});

// Obsługa przycisku "Wolniej"
slowerButton.addEventListener('click', () => {
    if (!slowerButton.classList.contains('disabled')) {
        // Zmniejsz indeks, ale nie poniżej zera
        currentSpeedMultiplierIndex = Math.max(0, currentSpeedMultiplierIndex - 1);
        animationSpeedMultiplier = speedMultipliers[currentSpeedMultiplierIndex];

        // Zaktualizuj tekst przycisku "Szybciej", aby był spójny
        if (animationSpeedMultiplier === 1) {
            fasterButton.textContent = '≫ Szybciej';
        } else {
            fasterButton.textContent = `≫ x${animationSpeedMultiplier}`;
        }

        console.log("Prędkość animacji: " + animationSpeedMultiplier + "x");
        if (animationInterval) {
            startAnimation();
        }
    }
});

resetButton.addEventListener('click', () => {
    if (!resetButton.classList.contains('disabled')) {
        resetAnimation();
        updateButtonStates(true, false);
    }
});


function startAnimation() {
    if (animationInterval) {
        clearInterval(animationInterval); // Wyczyść poprzedni interwał, jeśli istnieje
    }

    if (processedPoints.length === 0) return;

    // Czas trwania jednego "kroku" w milisekundach, im mniejsza wartość, tym szybciej
    // Domyślny krok to 100ms dla prędkości x1
    const animationStepMs = 100 / animationSpeedMultiplier; 

    animationInterval = setInterval(() => {
        if (animationIndex < processedPoints.length) {
            const currentPoint = processedPoints[animationIndex];
            
            // Aktualizuj pozycję roweru
            bikeMarker.setLatLng([currentPoint.lat, currentPoint.lon]);

            // Oblicz i wyświetl dystans i prędkość
            if (animationIndex > 0) {
                const totalDistanceCovered = calculateTotalDistance(processedPoints, animationIndex);
                displayDistanceSpan.textContent = `Dystans: ${totalDistanceCovered.toFixed(2)} km`;
                
                // Wyświetl prędkość z aktualnego punktu (w km/h)
                displaySpeedSpan.textContent = `Prędkość: ${(currentPoint.speed * 3.6).toFixed(1)} km/h`;
            } else {
                displayDistanceSpan.textContent = 'Dystans: 0.00 km';
                displaySpeedSpan.textContent = 'Prędkość: 0.0 km/h';
            }

            animationIndex++;
        } else {
            // Koniec animacji
            clearInterval(animationInterval);
            animationInterval = null;
            updateButtonStates(true, false); // Zaktualizuj przyciski na "zatrzymane"
        }
    }, animationStepMs);
}

function resetAnimation() {
    if (animationInterval) {
        clearInterval(animationInterval);
        animationInterval = null;
    }
    animationIndex = 0;
    if (processedPoints.length > 0) {
        const startPoint = processedPoints[0];
        bikeMarker.setLatLng([startPoint.lat, startPoint.lon]);
        map.setView([startPoint.lat, startPoint.lon], map.getZoom()); // Ustaw widok na początek trasy
    }
    displayDistanceSpan.textContent = 'Dystans: 0.00 km';
    displaySpeedSpan.textContent = 'Prędkość: 0.0 km/h';
    updateButtonStates(true, false); // Resetuj stan przycisków
}

// Funkcja do resetowania wszystkich elementów mapy
function resetMap() {
    if (currentTrackLayer) {
        map.removeLayer(currentTrackLayer);
        currentTrackLayer = null;
    }
    if (startMarker) {
        map.removeLayer(startMarker);
        startMarker = null;
    }
    if (endMarker) {
        map.removeLayer(endMarker);
        endMarker = null;
    }
    if (bikeMarker) {
        map.removeLayer(bikeMarker);
        bikeMarker = null;
    }
    if (animationInterval) {
        clearInterval(animationInterval);
        animationInterval = null;
    }
    animationIndex = 0;
    processedPoints = [];
    totalPointsSpan.textContent = 'Całkowita liczba punktów: 0';
    filteredPointsSpan.textContent = 'Liczba punktów po filtrowaniu (prędkość > 0.01 m/s): 0';
    displayDistanceSpan.textContent = 'Dystans: 0.00 km';
    displaySpeedSpan.textContent = 'Prędkość: 0.0 km/h';
    
    // Zresetuj tekst przycisku "Szybciej" i mnożnik
    currentSpeedMultiplierIndex = 0;
    animationSpeedMultiplier = speedMultipliers[currentSpeedMultiplierIndex];
    if (fasterButton) fasterButton.textContent = '≫ Szybciej'; // Upewnij się, że przycisk istnieje
}

// Funkcja do obliczania dystansu między dwoma punktami (haversine formula)
// Zwraca dystans w kilometrach
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI / 180; // φ, λ in radians
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    const d = R * c; // in metres
    return d / 1000; // in kilometers
}

// Funkcja obliczająca całkowity dystans do bieżącego indeksu
function calculateTotalDistance(points, currentIndex) {
    let totalDistance = 0;
    for (let i = 1; i <= currentIndex && i < points.length; i++) {
        const p1 = points[i - 1];
        const p2 = points[i];
        totalDistance += calculateDistance(p1.lat, p1.lon, p2.lat, p2.lon);
    }
    return totalDistance;
}

// Inicjalny stan przycisków
updateButtonStates(false);
