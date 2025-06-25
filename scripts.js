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

const createForm = document.getElementById('create-form');
if (createForm) {
    const messageP = document.getElementById('create-message');

    createForm.addEventListener('submit', async (evt) => {
        evt.preventDefault();

        const usernameEl = document.getElementById('username');
        const passwordEl = document.getElementById('password');
        const confirmPassword = document.getElementById('confirm-password').value;

        const username = usernameEl.value.trim()
        const password = passwordEl.value;

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
                body: new URLSearchParams({ username, password })
            });

            const data = await response.json();

            if (!response.ok) {
                messageP.textContent = data.message;
                return;
            }

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
            localStorage.setItem('date_created', data.date_created);
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
});


