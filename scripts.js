// scripts.js

const socket = new WebSocket('ws://localhost:35729');
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

    //display session name on session.html
    
    const projNameEl = document.getElementById('session-name');
    if (projNameEl) {
        const params = new URLSearchParams(window.location.search);
        const projId = params.get('id');
        if (!projId) {
            projNameEl.textContent = 'No session specified';
        }   else {
            fetch(`/sessions/${projId}`)
                .then(res => {
                    if (!res.ok) throw new Error(res.status);
                    return res.json();
                })
                .then(proj => {
                    projNameEl.textContent = proj.name;
                    document.title = proj.name;
                })
                .catch(err => {
                    console.error('Could not load session', err);
                    projNameEl.textContent = 'Error loading session';
                })
        }
    }

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

    //const backBtn = el('back-to-profile');
    //if (backBtn) backBtn.addEventListener('click', () => {
    //    window.location.href = 'profile.html';
    //});
});

async function initSessionUI() {
    const listEl = document.getElementById('session-list');
    const btn = document.getElementById('create-session-btn');
    const accountId = localStorage.getItem('account_id');

    async function loadSessions() {
        listEl.innerHTML = '';
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

            //delete
            const delBtn = document.createElement('button');
            delBtn.textContent = 'Delete';
            delBtn.addEventListener('click', async () => {
                const ok = confirm('Are you sure you want to delete this session? This action is permanent.');
                if (!ok) return;
                await fetch(`/sessions/${p.id}`, {method: 'DELETE' });
                loadSessions();
            });

            li.append(openBtn, delBtn);
            listEl.append(li);
        });
    }

    btn.addEventListener('click', async () => {
        const name = prompt('Enter listening session name:');
        if (!name) return;
        await fetch('/sessions', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ account_id: accountId, name })
        });

        //reload
        loadSessions();
    });

    //initial load
    loadSessions();
}
