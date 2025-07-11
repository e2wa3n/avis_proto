//account.js

document.addEventListener('DOMContentLoaded', () => {
    // 1) Identify signed-in user
    const username = localStorage.getItem('username');
    if (!username) {
        alert('Please sign in first.');
        window.location.href = 'signIn.html';
        return;
    }

    // 2) Cache all DOM nodes
    const view = {
        container:    document.getElementById('view-mode'),
        username:     document.getElementById('view-username'),
        first_name:   document.getElementById('view-first-name'),
        last_name:    document.getElementById('view-last-name'),
        email:        document.getElementById('view-email'),
        date_created: document.getElementById('view-date-created'),
        editBtn:      document.getElementById('edit-btn'),
        backBtn:      document.getElementById('back-btn'),
    };
    const edit = {
        form:        document.getElementById('edit-form'),
        username:    document.getElementById('edit-username'),
        first_name:  document.getElementById('edit-first-name'),
        last_name:   document.getElementById('edit-last-name'),
        email:       document.getElementById('edit-email'),
        password:    document.getElementById('edit-password'),
        error:       document.getElementById('edit-error'),
        cancelBtn:   document.getElementById('cancel-btn'),
    };

    // 3) Load account data from server and populate both view & edit fields
    async function loadAccount() {
        const res = await fetch(`/account?username=${encodeURIComponent(username)}`);
        if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
        const data = await res.json();

        // Populate view
        view.username.textContent     = data.username;
        view.first_name.textContent   = data.first_name;
        view.last_name.textContent    = data.last_name;
        view.email.textContent        = data.email;
        view.date_created.textContent = new Date(data.date_created).toLocaleDateString();

        // Populate edit inputs
        edit.username.value    = data.username;
        edit.first_name.value  = data.first_name;
        edit.last_name.value   = data.last_name;
        edit.email.value       = data.email;
        edit.password.value    = '';           // clear any old password
        edit.error.textContent = '';
    }

    // 4) Toggle into Edit mode
    view.editBtn.addEventListener('click', () => {
        view.container.style.display = 'none';
        edit.form.style.display      = '';
    });

    // 4b) Back → go to profile page
    view.backBtn.addEventListener('click', () => {
        window.location.href = 'profile.html';
    });

    // 5) Cancel button → back to view
    edit.cancelBtn.addEventListener('click', () => {
        edit.form.style.display      = 'none';
        view.container.style.display = '';
        edit.error.textContent       = '';
    });

    // 6) Handle form submission (Save)
    edit.form.addEventListener('submit', async e => {
        e.preventDefault();
        edit.error.textContent = '';

        // Gather payload
        const payload = {
            username,                          // current
            new_username:   edit.username.value.trim(),
            new_first_name: edit.first_name.value.trim(),
            new_last_name:  edit.last_name.value.trim(),
            new_email:      edit.email.value.trim(),
            password:       edit.password.value
        };

        // Front-end check: no empty
        for (let key in payload) {
            if (!payload[key]) {
                edit.error.textContent = 'All fields are required.';
                return;
            }
        }

        // POST to your existing /update-account route
        const res = await fetch('/update-account', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams(payload)
        });
        const data = await res.json();

        if (!res.ok) {
            edit.error.textContent = data.message;
            return;
        }

        // On success: update localStorage (username might have changed),
        // reload the view, and flip back to view mode
        edit.form.style.display       = 'none';
        view.container.style.display  = '';
        localStorage.setItem('username', data.username);
        await loadAccount();
    });

    // 7) Initial load
    loadAccount().catch(err => {
        console.error(err);
        alert('Could not load account info.');
    });
});
