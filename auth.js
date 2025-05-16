document.addEventListener('DOMContentLoaded', () => {
    // Auth Modal Functionality
    const loginBtn = document.getElementById('loginBtn');
    const registerBtn = document.getElementById('registerBtn');
    const authModal = document.getElementById('authModal');
    const modalClose = document.querySelector('.modal-close');
    const modalTabs = document.querySelectorAll('.modal-tab');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    const switchFormLinks = document.querySelectorAll('.switch-form');
    const roleBtns = document.querySelectorAll('.role-btn');
    const teacherFields = document.querySelectorAll('.teacher-field');
    const togglePasswordBtns = document.querySelectorAll('.toggle-password');
    
    // API URL - change this to your server URL
    const API_URL = '/api';
    
    // Добавим элементы управления для залогиненного пользователя
    const headerControls = document.querySelector('.header-controls');
    const authButtons = document.querySelector('.auth-buttons');
    let userMenuElement = null;

    // Check if user is logged in (token in localStorage)
    const token = localStorage.getItem('token');
    if (token) {
        fetchCurrentUser(token);
    }

    // Open modal functions
    function openModal(formType = 'login') {
        authModal.classList.add('active');
        document.body.style.overflow = 'hidden'; // Prevent scrolling when modal is open
        
        // Set the active tab
        modalTabs.forEach(tab => {
            if (tab.getAttribute('data-tab') === formType) {
                tab.classList.add('active');
            } else {
                tab.classList.remove('active');
            }
        });
        
        // Show the correct form
        if (formType === 'login') {
            loginForm.classList.add('active');
            registerForm.classList.remove('active');
        } else {
            registerForm.classList.add('active');
            loginForm.classList.remove('active');
        }
    }

    // Close modal function
    function closeModal() {
        authModal.classList.remove('active');
        document.body.style.overflow = ''; // Re-enable scrolling
    }

    // Open modal on button click
    loginBtn.addEventListener('click', () => openModal('login'));
    registerBtn.addEventListener('click', () => openModal('register'));

    // Close modal on close button or clicking outside
    modalClose.addEventListener('click', closeModal);
    authModal.addEventListener('click', (e) => {
        if (e.target === authModal) {
            closeModal();
        }
    });

    // Switch between tabs
    modalTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabType = tab.getAttribute('data-tab');
            
            // Update active tab
            modalTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            // Show corresponding form
            if (tabType === 'login') {
                loginForm.classList.add('active');
                registerForm.classList.remove('active');
            } else {
                registerForm.classList.add('active');
                loginForm.classList.remove('active');
            }
        });
    });

    // Switch between forms via links
    switchFormLinks.forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const formType = link.getAttribute('data-form');
            
            // Update tabs and show the form
            modalTabs.forEach(tab => {
                if (tab.getAttribute('data-tab') === formType) {
                    tab.click();
                }
            });
        });
    });

    // Toggle between student and teacher roles
    roleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Get the parent form
            const form = btn.closest('.auth-form');
            const role = btn.getAttribute('data-role');
            
            // Update active button styling
            form.querySelectorAll('.role-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            
            // Show/hide teacher-specific fields if needed
            if (form === registerForm) {
                if (role === 'teacher') {
                    teacherFields.forEach(field => field.style.display = 'block');
                } else {
                    teacherFields.forEach(field => field.style.display = 'none');
                }
            }
        });
    });

    // Toggle password visibility
    togglePasswordBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const input = btn.previousElementSibling;
            const icon = btn.querySelector('i');
            
            if (input.type === 'password') {
                input.type = 'text';
                icon.classList.remove('fa-eye');
                icon.classList.add('fa-eye-slash');
            } else {
                input.type = 'password';
                icon.classList.remove('fa-eye-slash');
                icon.classList.add('fa-eye');
            }
        });
    });

    // Async function to fetch current user data
    async function fetchCurrentUser(token) {
        try {
            const response = await fetch(`${API_URL}/auth/me`, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });
            
            const data = await response.json();
            
            if (data.success) {
                showLoggedInUI(data.data);
            } else {
                // Token is invalid or expired
                localStorage.removeItem('token');
            }
        } catch (error) {
            console.error('Error fetching user data:', error);
            localStorage.removeItem('token');
        }
    }

    // Function for displaying the UI for logged in users
    function showLoggedInUI(user) {
        // Удаляем кнопки входа и регистрации
        authButtons.innerHTML = '';
        
        // Создаем меню пользователя
        userMenuElement = document.createElement('div');
        userMenuElement.className = 'user-menu';
        
        const userInfo = document.createElement('div');
        userInfo.className = 'user-info';
        userInfo.innerHTML = `
            <span class="user-name">${user.name}</span>
            <span class="user-role ${user.role}">${user.role.charAt(0).toUpperCase() + user.role.slice(1)}</span>
        `;
        
        const dropdownButton = document.createElement('button');
        dropdownButton.className = 'dropdown-toggle';
        dropdownButton.innerHTML = '<i class="fas fa-user-circle"></i> <i class="fas fa-chevron-down"></i>';
        
        const dropdownMenu = document.createElement('div');
        dropdownMenu.className = 'dropdown-menu';
        
        // Different menu items based on user role
        let menuItems = `
            <a href="#profile"><i class="fas fa-user"></i> Profile</a>
            <a href="#" id="logoutBtn"><i class="fas fa-sign-out-alt"></i> Logout</a>
        `;
        
        if (user.role === 'student') {
            menuItems = `
                <a href="#submissions"><i class="fas fa-tasks"></i> My Submissions</a>
                <a href="#profile"><i class="fas fa-user"></i> Profile</a>
                <a href="#" id="logoutBtn"><i class="fas fa-sign-out-alt"></i> Logout</a>
            `;
        } else if (user.role === 'teacher') {
            menuItems = `
                <a href="#dashboard"><i class="fas fa-tachometer-alt"></i> Dashboard</a>
                <a href="#students"><i class="fas fa-users"></i> Students</a>
                <a href="#assignments"><i class="fas fa-book"></i> Assignments</a>
                <a href="#profile"><i class="fas fa-user"></i> Profile</a>
                <a href="#" id="logoutBtn"><i class="fas fa-sign-out-alt"></i> Logout</a>
            `;
        } else if (user.role === 'admin') {
            menuItems = `
                <a href="#admin"><i class="fas fa-cog"></i> Admin Panel</a>
                <a href="#users"><i class="fas fa-users"></i> Users</a>
                <a href="#profile"><i class="fas fa-user"></i> Profile</a>
                <a href="#" id="logoutBtn"><i class="fas fa-sign-out-alt"></i> Logout</a>
            `;
        }
        
        dropdownMenu.innerHTML = menuItems;
        
        userMenuElement.appendChild(userInfo);
        userMenuElement.appendChild(dropdownButton);
        userMenuElement.appendChild(dropdownMenu);
        
        authButtons.appendChild(userMenuElement);
        
        // Verification badge if email is not verified
        if (!user.emailVerified) {
            const verificationBadge = document.createElement('div');
            verificationBadge.className = 'verification-badge';
            verificationBadge.innerHTML = '<i class="fas fa-exclamation-triangle"></i> Email not verified';
            
            verificationBadge.addEventListener('click', () => {
                resendVerificationEmail(user.email);
            });
            
            userMenuElement.appendChild(verificationBadge);
        }
        
        // Добавляем обработчик для кнопки выхода
        document.getElementById('logoutBtn').addEventListener('click', (e) => {
            e.preventDefault();
            logout();
        });
        
        // Показываем/скрываем выпадающее меню
        dropdownButton.addEventListener('click', () => {
            dropdownMenu.classList.toggle('active');
        });
        
        // Закрываем меню при клике вне его
        document.addEventListener('click', (e) => {
            if (userMenuElement && !userMenuElement.contains(e.target)) {
                dropdownMenu.classList.remove('active');
            }
        });
    }

    // Function to resend verification email
    async function resendVerificationEmail(email) {
        try {
            showFormMessage(null, 'Sending verification email...', 'info');
            
            const response = await fetch(`${API_URL}/auth/forgotpassword`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email })
            });
            
            const data = await response.json();
            
            if (data.success) {
                showFormMessage(null, 'Verification email sent successfully. Please check your inbox.', 'success');
            } else {
                showFormMessage(null, data.error || 'Failed to send verification email', 'error');
            }
        } catch (error) {
            console.error('Error resending verification email:', error);
            showFormMessage(null, 'An error occurred. Please try again later.', 'error');
        }
    }
    
    // Logout function
    async function logout() {
        try {
            const token = localStorage.getItem('token');
            
            if (token) {
                await fetch(`${API_URL}/auth/logout`, {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${token}`
                    }
                });
            }
        } catch (error) {
            console.error('Error during logout:', error);
        }
        
        // Remove token regardless of API call success
        localStorage.removeItem('token');
        
        // Восстанавливаем кнопки авторизации
        authButtons.innerHTML = `
            <button id="loginBtn" class="btn btn-outline">LOG IN</button>
            <button id="registerBtn" class="btn">REGISTER</button>
        `;
        
        // Перезагружаем обработчики событий для кнопок
        document.getElementById('loginBtn').addEventListener('click', () => openModal('login'));
        document.getElementById('registerBtn').addEventListener('click', () => openModal('register'));
        
        // Удаляем меню пользователя
        userMenuElement = null;
    }
    
    // Modify the login form submission event handler
    loginForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        
        // Get form values
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        const role = document.querySelector('.role-btn.active').getAttribute('data-role');
        
        // Demo account check - hardcoded for demonstration
        if (role === 'teacher' && email === 'teacher@example.com' && password === 'password') {
            // Set teacher account
            localStorage.setItem('isLoggedIn', 'true');
            localStorage.setItem('userRole', 'teacher');
            localStorage.setItem('userName', 'Teacher Account');
            localStorage.setItem('userEmail', email);
            
            // Redirect to teacher dashboard
            window.location.href = 'teacher-dashboard.html';
            return;
        }
        
        if (role === 'student' && email === 'student@example.com' && password === 'password') {
            // Set student account
            localStorage.setItem('isLoggedIn', 'true');
            localStorage.setItem('userRole', 'student');
            localStorage.setItem('userName', 'Student Account');
            localStorage.setItem('userEmail', email);
            
            // Redirect to student dashboard
            window.location.href = 'student-dashboard.html';
            return;
        }
        
        // Show error message if credentials don't match
        showFormMessage(loginForm, 'Invalid email or password. For demo, use teacher@example.com/password or student@example.com/password', 'error');
    });
    
    // Form submission - Register
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const name = registerForm.querySelector('#register-name').value;
        const email = registerForm.querySelector('#register-email').value;
        const password = registerForm.querySelector('#register-password').value;
        const role = registerForm.querySelector('.role-btn.active').getAttribute('data-role');
        const agreeTerms = registerForm.querySelector('#agree-terms').checked;
        let institution = null;
        
        // Validation
        if (!name || !email || !password) {
            showFormMessage(registerForm, 'Please fill in all required fields', 'error');
            registerForm.classList.add('error');
            setTimeout(() => registerForm.classList.remove('error'), 500);
            return;
        }
        
        // Password length validation
        if (password.length < 8) {
            showFormMessage(registerForm, 'Password must be at least 8 characters long', 'error');
            registerForm.classList.add('error');
            setTimeout(() => registerForm.classList.remove('error'), 500);
            return;
        }
        
        if (!agreeTerms) {
            showFormMessage(registerForm, 'You must agree to the terms and conditions', 'error');
            return;
        }
        
        // Additional validation for teacher
        if (role === 'teacher') {
            institution = registerForm.querySelector('#register-institution').value;
            if (!institution) {
                showFormMessage(registerForm, 'Institution is required for teachers', 'error');
                return;
            }
        }
        
        // Show loading state
        const submitBtn = registerForm.querySelector('[type="submit"]');
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Creating account...';
        submitBtn.disabled = true;
        
        console.log(`Attempting to register with: email=${email}, role=${role}`);
        
        try {
            const response = await fetch(`${API_URL}/auth/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name,
                    email,
                    password,
                    role,
                    institution
                })
            });
            
            console.log('Register response status:', response.status);
            const data = await response.json();
            console.log('Register response data:', data);
            
            if (data.success) {
                showFormMessage(registerForm, 'Account created successfully! Please check your email for verification.', 'success');
                
                // Save token
                localStorage.setItem('token', data.token);
                
                // Close modal and show user UI
                setTimeout(() => {
                    closeModal();
                    showLoggedInUI(data.user);
                }, 1500);
            } else {
                showFormMessage(registerForm, data.error || 'Registration failed', 'error');
                submitBtn.textContent = originalText;
                submitBtn.disabled = false;
            }
        } catch (error) {
            console.error('Registration error:', error);
            showFormMessage(registerForm, `Connection error: ${error.message}`, 'error');
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
        }
    });

    // Helper function to show form messages
    function showFormMessage(form, message, type) {
        // Create message element at document level if form is null
        if (!form) {
            let globalMessage = document.querySelector('.global-message');
            
            if (!globalMessage) {
                globalMessage = document.createElement('div');
                globalMessage.className = 'global-message';
                document.body.appendChild(globalMessage);
            }
            
            globalMessage.textContent = message;
            globalMessage.className = 'global-message ' + type;
            globalMessage.style.display = 'block';
            
            setTimeout(() => {
                globalMessage.style.display = 'none';
            }, 5000);
            
            return;
        }
        
        // Check if a message element already exists in the form
        let messageElement = form.querySelector('.form-message');
        
        // If not, create one
        if (!messageElement) {
            messageElement = document.createElement('div');
            messageElement.className = 'form-message';
            form.insertBefore(messageElement, form.firstChild);
        }
        
        // Set message and type
        messageElement.textContent = message;
        messageElement.className = 'form-message ' + type;
        messageElement.style.display = 'block';
        
        // Hide message after a few seconds for error messages
        if (type === 'error' || type === 'info') {
            setTimeout(() => {
                messageElement.style.display = 'none';
            }, 5000);
        }
    }
}); 