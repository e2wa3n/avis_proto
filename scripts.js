// scripts.js

const socket = new WebSocket('ws://localhost:3000');
let weatherChartInstance = null; //variable for weather graph
let sessionData = null;

socket.addEventListener('message', () => {
    location.reload();
});

const toCreateAcc = document.getElementById('to_create_acc');
if (toCreateAcc) {
    toCreateAcc.addEventListener('click', () => {
        window.location.href = 'createAcc.html';
    });
}

const toSignIn = document.getElementById('to_signin');
if (toSignIn) {
    toSignIn.addEventListener('click', () => {
        window.location.href = 'signIn.html';
    });
}

const toAbout = document.getElementById('to_about');
if (toAbout) {
    toAbout.addEventListener('click', () => {
        window.location.href = 'about.html';
    });
}

const toHome = document.getElementById('to_home');
if (toHome) {
    toHome.addEventListener('click', () => {
        window.location.href = 'index.html';
    });
}

const toChangeInfo = document.getElementById('to-change-info');
if (toChangeInfo) {
    toChangeInfo.addEventListener('click', () => {
        window.location.href = 'changeAccountInfo.html';
    });
}

const createForm = document.getElementById('create-form');
if (createForm) {
    const messageP = document.getElementById('create-message');

    createForm.addEventListener('submit', async (evt) => {
        evt.preventDefault();

        const usernameEl = document.getElementById('username');
        const passwordEl = document.getElementById('password');
        const confirmPassword = document.getElementById('confirm-password').value;

        const emailEl = document.getElementById('email');
        const email = emailEl.value.trim();

        const username = usernameEl.value.trim()
        const password = passwordEl.value;

        const first_name = document.getElementById('first-name').value.trim();
        const last_name = document.getElementById('last-name').value.trim();

        if (!first_name || !last_name) {
            messageP.textContent = 'Please enter both first and last name';
            return;
        }

        if (!email) {
            messageP.textContent = 'Please enter your email';
            return;
        }

        if (!username || !password) {
            messageP.textContent = 'Please enter your both a username and a password';
            return;
        }

        if (password !== confirmPassword) {
            messageP.textContent = 'Passwords do not match';
            return;
        }

        messageP.textContent = '';

        try {
            const response = await fetch('/create-account', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({ username, email, first_name, last_name, password })
            });

            const data = await response.json();

            if (!response.ok) {
                messageP.textContent = data.message;
                return;
            }

            localStorage.setItem('username',    data.username);
            localStorage.setItem('account_id',  data.account_id);
            localStorage.setItem('date_created',data.date_created);
            localStorage.setItem('first_name',  data.first_name);
            localStorage.setItem('last_name',   data.last_name);
            localStorage.setItem('email',       data.email);

            alert('Account created Successfully!\n\nYou will now be directed to sign in');
            window.location.href = '/signIn.html';
        }   catch (err) {
            console.error('Network Error or JSON error', err);
            messageP.textContent = 'Network error. Please try again later.';
        }
    });
}



const signInForm = document.getElementById('signin-form');

if (signInForm) {
    const signinMsg = document.getElementById('signin-message');

    signInForm.addEventListener('submit', async (evt) => {
        evt.preventDefault();

        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;

        if(!username || !password) {
            signinMsg.textContent = 'Please enter both username and password';
            return;
        }
        signinMsg.textContent = '';

        try {
            const response = await fetch('/sign-in', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({ username, password })
            });

            const data = await response.json();

            if (!response.ok) {
                signinMsg.textContent = data.message;
                return;
            }

            localStorage.setItem('username', data.username);
            localStorage.setItem('account_id', data.account_id);
            localStorage.setItem('date_created', data.date_created);
            localStorage.setItem('first_name', data.first_name);
            localStorage.setItem('last_name', data.last_name);
            localStorage.setItem('email', data.email);
            alert('Sign-in successful!\n\nRedirecting to your profile');
            window.location.href= 'profile.html';

        } catch (err) {
            console.error('Fetch/JSON error during sign-in', err);
            signinMsg.textContent = 'Network error. Please try again later.';
        }
    });
}

const signOutBtn = document.getElementById('to_signout');
if (signOutBtn) {
    signOutBtn.addEventListener('click', () => {
        window.location.href = 'index.html';
    });
}

const forgotPassBtn = document.getElementById('to_forgot_pass');
if (forgotPassBtn) {
    forgotPassBtn.addEventListener('click', () => {
        window.location.href = 'forgotPass.html';
    });
}

const toAccountInfo = document.getElementById('to_account_info');
if (toAccountInfo) {
        toAccountInfo.addEventListener('click', () => {
            window.location.href = 'account.html';
    });
}

document.addEventListener('DOMContentLoaded', () => {
    const userNameEl = document.getElementById('user-name');
    const memberSinceEl = document.getElementById('member-since');

    if(userNameEl && memberSinceEl) {
        const username = localStorage.getItem('username');
        const dateCreated = localStorage.getItem('date_created');

        userNameEl.textContent = username || '';
        memberSinceEl.textContent = dateCreated
            ? new Date(dateCreated).toLocaleDateString()
            : '';
    }
    initSessionUI();
    initDeviceUI();
    loadSessionData();
    initTabs();

    //back button on session.html

    const backBtn = document.getElementById('back-to-profile');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            window.location.href = 'profile.html';
        });
    }

    const changeBtn = document.getElementById('change-pass-btn');
    if (changeBtn) {
        const username = localStorage.getItem('username');
        changeBtn.addEventListener('click', () => {
            window.location.href = `changePass.html?username=${encodeURIComponent(username)}`;
        });
    }

    const params = new URLSearchParams(window.location.search);
    const cpUser = params.get('username');
    if (cpUser) {
        const span = document.getElementById('cp-username');
        if (span) span.textContent = cpUser;
    }

    const changeForm = document.getElementById('change-pass-form');
    const msgP = document.getElementById('change-msg');
    if (changeForm) {
        changeForm.addEventListener('submit', async evt => {
            evt.preventDefault();
            const newPw = document.getElementById('new-password').value;
            const confirm = document.getElementById('confirm-password').value;
            if (newPw !== confirm) {
                msgP.textContent = 'Passwords do not match';
                return;
            }
            msgP.textContent = '';
            try {
                const response = await fetch('/change-password', {
                    method: 'POST',
                    headers: {'Content-Type': 'application/x-www-form-urlencoded'},
                    body: new URLSearchParams({
                        username: cpUser,
                        password: newPw
                    })
                });
                const data = await response.json();
                if (!response.ok) {
                    msgP.textContent = data.message;
                    return;
                }
                alert('Password changed successfully!');
                window.location.href = 'index.html';
            } catch (err) {
                console.error('Error changing password', err);
                msgP.textContent = 'Network error-please try again.';
            }
        });

        const cancel = document.getElementById('cancel-btn');
        cancel.addEventListener('click', () => window.location.href = 'index.html');
    }

    const forgotForm = document.getElementById('forgot-pass-form');
    if (forgotForm) {
        const msgP = document.createElement('p');
        msgP.style.color = 'red';
        forgotForm.append(msgP);

        forgotForm.addEventListener('submit', async evt => {
            evt.preventDefault();
            const username   = document.getElementById('username').value.trim();
            const first_name = document.getElementById('first-name').value.trim();
            const last_name  = document.getElementById('last-name').value.trim();
            const email      = document.getElementById('email').value.trim();

            if (!username || !first_name || !last_name || !email) {
                msgP.textContent = 'Please fill in every field';
                return;
            }
            msgP.textContent = '';

            try {
                const res = await fetch('/forgot-password', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ username, first_name, last_name, email })
                });
                const data = await res.json();
                if (!res.ok) {
                    msgP.textContent = data.message;
                    return;
                }
                // on success, send them on to changePass.html
                window.location.href = `changePass.html?username=${encodeURIComponent(username)}`;
            }   catch (err) {
                console.error('Network error during forgot-password', err);
                msgP.textContent = 'Network error—please try again.';
            }
        });
    }

    const el = id => document.getElementById(id);

    if (el('cp-username')) {
        el('cp-username').textContent      = localStorage.getItem('username')    || '';
        el('cp-first-name').textContent    = localStorage.getItem('first_name')  || '';
        el('cp-last-name').textContent     = localStorage.getItem('last_name')   || '';
        el('cp-email').textContent         = localStorage.getItem('email')       || '';
        const dt = localStorage.getItem('date_created');
        el('cp-date-created').textContent  = dt ? new Date(dt).toLocaleDateString() : '';
    }

    const closeSessionBtn = document.getElementById('close-session-btn');
    if (closeSessionBtn) {
        closeSessionBtn.addEventListener('click', async () => {
            const params = new URLSearchParams(window.location.search);
            const sessionId = params.get('id');
            if (!sessionId) return;

            const ok = confirm('Are you sure you want to end this session?');
            if (ok) {
                await fetch(`/sessions/${sessionId}/close`, { method: 'PUT' });
                alert('Session has been closed.');
                window.location.href = 'profile.html'; // Go back to profile
            }
        });
    }
});

async function initSessionUI() {
    const sessionListEl = document.getElementById('session-list');
    const createSessionForm = document.getElementById('create-session-form');
    const deviceSelectEl = document.getElementById('session-device-select');
    const sessionNameInput = document.getElementById('session-name-input');
    const accountId = localStorage.getItem('account_id');

    // This function fetches existing SESSIONS and displays them in a list
    async function loadAndDisplaySessions() {
        if (!sessionListEl || !accountId) return;
        sessionListEl.innerHTML = '';
        const res = await fetch(`/sessions?account_id=${accountId}`);
        const sessions = await res.json();
        sessions.forEach(p => {
            const li = document.createElement('li');
            li.textContent = p.name;
            
            const openBtn = document.createElement('button');
            openBtn.textContent = 'Open';
            openBtn.addEventListener('click', () => {
                window.location.href = `/session.html?id=${p.id}`;
            });

            const delBtn = document.createElement('button');
            delBtn.textContent = 'Delete';
            delBtn.addEventListener('click', async () => {
                const ok = confirm('Are you sure you want to delete this session? This action is permanent.');
                if (!ok) return;
                await fetch(`/sessions/${p.id}`, {method: 'DELETE' });
                loadAndDisplaySessions(); // Reload the list after deleting
            });

            li.append(openBtn, delBtn);
            sessionListEl.append(li);
        });
    }

    // This function fetches registered DEVICES and populates the dropdown
    async function populateDeviceSelect() {
        if (!deviceSelectEl || !accountId) return;
        try {
            const response = await fetch(`/devices?account_id=${accountId}`);
            const devices = await response.json();
            deviceSelectEl.innerHTML = ''; // Clear loading message

            if (devices.length === 0) {
                deviceSelectEl.innerHTML = '<option value="">--Please register a device first--</option>';
            } else {
                devices.forEach(device => {
                    const option = document.createElement('option');
                    option.value = device.device_id;
                    option.textContent = device.devEUI;
                    deviceSelectEl.appendChild(option);
                });
            }
        } catch (err) {
            console.error('Failed to populate devices:', err);
        }
    }

    // Add event listener for the new session form
    if (createSessionForm) {
        createSessionForm.addEventListener('submit', async (evt) => {
            evt.preventDefault();
            const name = sessionNameInput.value.trim();
            const deviceId = deviceSelectEl.value;

            if (!name || !deviceId) {
                alert('Please enter a session name and select a device.');
                return;
            }

            await fetch('/sessions', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ 
                    account_id: accountId, 
                    name: name,
                    device_id: deviceId
                })
            });

            // Reload the list of sessions to show the new one
            loadAndDisplaySessions();
            createSessionForm.reset(); // Clear the form
        });
    }

    // Initial data loads when the page is ready
    loadAndDisplaySessions();
    populateDeviceSelect();
}

// --- DEVICE MANAGEMENT UI ---

async function initDeviceUI() {
    const deviceListEl = document.getElementById('device-list');
    const deviceForm = document.getElementById('register-device-form');
    const messageP = document.getElementById('device-message');
    const accountId = localStorage.getItem('account_id');

    // 1. Function to fetch and display the user's devices
    async function loadAndDisplayDevices() {
        if (!accountId || !deviceListEl) return;

        // Clear the current list
        deviceListEl.innerHTML = '<li>Loading...</li>';

        try {
            const response = await fetch(`/devices?account_id=${accountId}`);
            if (!response.ok) {
                throw new Error(`Server returned an error: ${response.statusText}`);
            }
            const devices = await response.json();

            // Clear the "Loading..." message
            deviceListEl.innerHTML = '';

            if (devices.length === 0) {
                deviceListEl.innerHTML = '<li>You have no registered devices.</li>';
            } else {
                devices.forEach(device => {
                    const li = document.createElement('li');
                    li.textContent = `Device EUI: ${device.devEUI}`;
                    deviceListEl.appendChild(li);
                });
            }
        } catch (err) {
            console.error('Failed to load devices:', err);
            deviceListEl.innerHTML = '<li>Could not load devices.</li>';
        }
    }

    // 2. Add event listener for the registration form
    if (deviceForm) {
        deviceForm.addEventListener('submit', async (evt) => {
            evt.preventDefault();
            messageP.textContent = ''; // Clear previous messages

            const devEUI = document.getElementById('device-id').value.trim();
            if (!devEUI) {
                messageP.textContent = 'Device EUI cannot be empty.';
                return;
            }

            try {
                const response = await fetch('/devices', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        account_id: accountId,
                        devEUI: devEUI
                    })
                });

                const data = await response.json();

                if (!response.ok) {
                    messageP.textContent = data.message || 'Error registering device.';
                } else {
                    alert('Device registered successfully!');
                    deviceForm.reset(); // Clear the form input
                    loadAndDisplayDevices(); // Refresh the list
                }
            } catch (err) {
                console.error('Device registration fetch error:', err);
                messageP.textContent = 'A network error occurred. Please try again.';
            }
        });
    }

    // 3. Initial load of devices when the page is ready
    loadAndDisplayDevices();
}

async function loadSessionData() {
    const params = new URLSearchParams(window.location.search);
    const sessionId = params.get('id');
    const sessionNameEl = document.getElementById('session-name');

    if (!sessionId || !document.getElementById('bird-log')) {
        return; // Exit if not on a session page
    }

    try {
        const res = await fetch(`/sessions/${sessionId}/data`);
        if (!res.ok) {
            throw new Error(`Failed to fetch data: ${res.status} ${res.statusText}`);
        }
        const data = await res.json();
        
        // 1. Store the data globally for the chart to use later
        sessionData = data;
        console.log('Checkpoint 1: Session data loaded and stored.', sessionData);
        
        // 2. Update the page title
        if(data.details && sessionNameEl) {
            sessionNameEl.textContent = data.details.p_name;
            document.title = data.details.p_name;
        }

        // 3. Render all the raw data for the first tab
        renderAllData(sessionData);

    } catch (err) {
        console.error('Error loading session data:', err);
        if (sessionNameEl) {
            sessionNameEl.textContent = 'Error: Could not load session data.';
        }
    }
}

function renderAllData(data) {
    // Render GPS Data
    const gpsContainer = document.getElementById('gps-data');
    if (data.nodes && data.nodes.length > 0) {
        const node = data.nodes[0];
        gpsContainer.innerHTML = `
            <h3>Node Location</h3>
            <p>Latitude: ${node.lat}, Longitude: ${node.lng}, Altitude: ${node.altitude}</p>
        `;
    }

    // Render Weather Data List
    setupShowMoreLess('weather-log', 'weather-controls', data.weather, (w) => {
        const li = document.createElement('li');
        const d = new Date(w.timestamp).toLocaleString();
        const tempC = w.temperature;
        const tempF = Math.round((tempC * 9/5) + 32);
        li.textContent = `${d}: Temp: ${tempF}°F, Humidity: ${w.humidity}%, Pressure: ${w.pressure} inHg`;
        return li;
    });

    // Render Bird Data List
    setupShowMoreLess('bird-log', 'bird-controls', data.birds, (b) => {
        const li = document.createElement('li');
        const d = new Date(b.timestamp).toLocaleString();
        const confidenceText = b.confidence_level ? `${b.confidence_level}%` : 'N/A';
        li.textContent = `${d}: ${b.species} (Confidence: ${confidenceText})`;
        return li;
    });
}

function setupShowMoreLess(listElementId, controlsElementId, allItems, renderItem) {
    const listEl = document.getElementById(listElementId);
    const controlsEl = document.getElementById(controlsElementId);
    let isShowingAll = false;

    // Clear any previous content
    listEl.innerHTML = '';
    controlsEl.innerHTML = '';

    // Create a reversed copy of the items to always show newest first
    const reversedItems = [...allItems].reverse();

    if (reversedItems.length <= 15) {
        // If 15 or fewer items, just render them all and we're done
        reversedItems.forEach(item => listEl.appendChild(renderItem(item)));
        return;
    }

    // If more than 15 items, create the button and render logic
    const showMoreBtn = document.createElement('button');
    controlsEl.appendChild(showMoreBtn);

    const render = () => {
        listEl.innerHTML = '';
        const itemsToRender = isShowingAll ? reversedItems : reversedItems.slice(0, 15); // Get all or the first 15 of the reversed list
        
        itemsToRender.forEach(item => listEl.appendChild(renderItem(item)));
        
        showMoreBtn.textContent = isShowingAll ? 'Show Less' : 'Show More';
    };

    showMoreBtn.addEventListener('click', () => {
        isShowingAll = !isShowingAll; // Flip the state
        render();
    });

    render(); // Initial render
}

function initTabs() {
    const tabButtons = document.querySelectorAll('.tab-btn');
    const tabPanels = document.querySelectorAll('.tab-panel');
    let isChartRendered = false; // Add a flag to prevent re-drawing

    if (tabButtons.length === 0) return;

    tabButtons.forEach(button => {
        button.addEventListener('click', () => {
            const targetTabId = button.dataset.tab;

            console.log(`Checkpoint 2: Tab clicked. Target: ${targetTabId}, Chart Rendered: ${isChartRendered}, sessionData available: ${!!sessionData}`); //bug finder 2

            // --- NEW LOGIC IS HERE ---
            // If the weather tab is clicked and the chart hasn't been drawn yet
            if (targetTabId === 'weather-graph' && !isChartRendered && sessionData) {
                renderWeatherChart(sessionData.weather);
                isChartRendered = true; // Set the flag so it doesn't draw again
            }
            // --- END OF NEW LOGIC ---

            tabButtons.forEach(btn => btn.classList.remove('active'));
            tabPanels.forEach(panel => panel.classList.remove('active'));

            button.classList.add('active');
            document.getElementById(targetTabId).classList.add('active');
        });
    });
}

function renderWeatherChart(weatherData) {

    console.log('Checkpoint 3: renderWeatherChart was called with data:', weatherData); //bug finder 3

    const ctx = document.getElementById('weatherChart');
    if (!ctx) return; // Exit if the canvas element isn't on the page

    // Destroy the previous chart instance if it exists
    if (weatherChartInstance) {
        weatherChartInstance.destroy();
    }

    // 1. Format the data for Chart.js
    const labels = weatherData.map(w => new Date(w.timestamp).toLocaleTimeString());
    const tempData = weatherData.map(w => Math.round((w.temperature * 9/5) + 32));
    const humidityData = weatherData.map(w => w.humidity);

    // 2. Create the chart
    weatherChartInstance = new Chart(ctx, {
        type: 'line', // We want a line graph
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Temperature (°F)',
                    data: tempData,
                    borderColor: 'rgba(255, 99, 132, 1)', // Red
                    tension: 0.1
                },
                {
                    label: 'Humidity (%)',
                    data: humidityData,
                    borderColor: 'rgba(54, 162, 235, 1)', // Blue
                    tension: 0.1
                }
            ]
        },
        options: {
            responsive: true,
            scales: {
                y: {
                    beginAtZero: false
                }
            }
        }
    });
}
