document.addEventListener('DOMContentLoaded', () => {
    // Header transparency effect
    const header = document.querySelector('header');
    
    window.addEventListener('scroll', () => {
        if (window.scrollY > 100) {
            header.classList.add('scrolled');
        } else {
            header.classList.remove('scrolled');
        }
    });

    /*
     * 3D Parallax Effects (Currently Disabled)
     * Uncomment to re-enable this functionality
     * 
    const parallaxContainer = document.querySelector('.parallax-container');
    if (parallaxContainer) {
        const layers = document.querySelectorAll('.parallax-layer');
        const marble = document.querySelector('.marble-object');
        const marbleShadow = document.querySelector('.marble-shadow');
        const matrixCube = document.querySelector('.matrix-cube');
        const cubeShadow = document.querySelector('.cube-shadow');
        
        // Track if mouse is over the container
        let isMouseOver = false;
        
        parallaxContainer.addEventListener('mouseenter', () => {
            isMouseOver = true;
        });
        
        parallaxContainer.addEventListener('mouseleave', () => {
            isMouseOver = false;
            // Reset positions when mouse leaves
            if (marble) marble.style.transform = "translate(-50%, -50%) rotate(-15deg)";
            if (marbleShadow) {
                marbleShadow.style.transform = "translateX(-50%) scaleX(1.5) rotateX(60deg)";
                marbleShadow.style.opacity = "0.35";
            }
            if (matrixCube) matrixCube.style.transform = "translate(-50%, -50%) rotate(10deg)";
            if (cubeShadow) {
                cubeShadow.style.transform = "translateX(-50%) scaleX(1.3) rotateX(60deg)";
                cubeShadow.style.opacity = "0.3";
            }
        });
        
        document.addEventListener('mousemove', (e) => {
            if (!isMouseOver) return;
            
            // Get mouse position relative to the container
            const rect = parallaxContainer.getBoundingClientRect();
            const x = e.clientX - rect.left; // x position within the container
            const y = e.clientY - rect.top;  // y position within the container
            
            // Calculate how far from center the mouse is (in percentage)
            const centerOffsetX = (x / rect.width - 0.5) * 2; // -1 to 1
            const centerOffsetY = (y / rect.height - 0.5) * 2; // -1 to 1
            
            // Move marble based on mouse position - subtle movement
            if (marble) {
                marble.style.transform = `translate(-50%, -50%) translateX(${centerOffsetX * 15}px) translateY(${centerOffsetY * 10}px) rotate(${-15 + centerOffsetX * 2}deg)`;
            }
            
            // Move marble shadow accordingly
            if (marbleShadow) {
                marbleShadow.style.transform = `translateX(-50%) translateX(${centerOffsetX * 20}px) translateY(${centerOffsetY * 10}px) scaleX(${1.5 - Math.abs(centerOffsetY) * 0.2}) rotateX(60deg)`;
                
                // Adjust shadow opacity based on vertical mouse position
                const shadowOpacity = 0.25 + (centerOffsetY > 0 ? centerOffsetY * 0.2 : 0);
                marbleShadow.style.opacity = shadowOpacity;
            }
            
            // Move matrix cube with slightly different effect
            if (matrixCube) {
                // Move in opposite direction to marble for depth effect
                matrixCube.style.transform = `translate(-50%, -50%) translateX(${centerOffsetX * -12}px) translateY(${centerOffsetY * -8}px) rotate(${10 - centerOffsetX * 3}deg)`;
            }
            
            // Move cube shadow accordingly
            if (cubeShadow) {
                cubeShadow.style.transform = `translateX(-50%) translateX(${centerOffsetX * -15}px) translateY(${centerOffsetY * -5}px) scaleX(${1.3 - Math.abs(centerOffsetY) * 0.2}) rotateX(60deg)`;
                
                // Adjust shadow opacity based on vertical mouse position
                const cubeShadowOpacity = 0.2 + (centerOffsetY > 0 ? centerOffsetY * 0.2 : 0);
                cubeShadow.style.opacity = cubeShadowOpacity;
            }
        });
    }
    */

    // Smooth scrolling for navigation links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function (e) {
            e.preventDefault();
            
            const targetId = this.getAttribute('href');
            if (targetId === '#') return;
            
            const targetElement = document.querySelector(targetId);
            if (targetElement) {
                window.scrollTo({
                    top: targetElement.offsetTop - 80, // Offset for fixed header
                    behavior: 'smooth'
                });
            }
        });
    });

    // Parallax scrolling effect for hero section
    const hero = document.querySelector('.hero');
    window.addEventListener('scroll', () => {
        if (window.scrollY < window.innerHeight) {
            const scrollValue = window.scrollY * 0.5;
            hero.style.backgroundPositionY = `-${scrollValue}px`;
        }
    });

    // Fade in elements when they come into view
    const fadeInElements = document.querySelectorAll('.fade-in');
    
    const fadeInObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                fadeInObserver.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.2,
        rootMargin: '0px 0px -100px 0px'
    });
    
    fadeInElements.forEach(element => {
        fadeInObserver.observe(element);
    });

    // Initialize stats counters
    const statNumbers = document.querySelectorAll('.stat-number');
    
    const statsObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                animateCounter(entry.target);
                statsObserver.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.8
    });
    
    statNumbers.forEach(stat => {
        statsObserver.observe(stat);
    });

    // Function to animate the counters
    function animateCounter(element) {
        const target = parseInt(element.textContent.replace(/[^0-9]/g, ''));
        const suffix = element.textContent.replace(/[0-9]/g, '');
        const duration = 2000;
        const step = 50;
        let current = 0;
        const increment = target / (duration / step);
        
        const timer = setInterval(() => {
            current += increment;
            if (current >= target) {
                element.textContent = target + suffix;
                clearInterval(timer);
            } else {
                element.textContent = Math.floor(current) + suffix;
            }
        }, step);
    }

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

    // Form submission handling
    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const email = loginForm.querySelector('#login-email').value;
        const password = loginForm.querySelector('#login-password').value;
        const role = loginForm.querySelector('.role-btn.active').getAttribute('data-role');
        
        // Simple validation
        if (!email || !password) {
            showFormMessage(loginForm, 'Please fill in all fields', 'error');
            loginForm.classList.add('error');
            setTimeout(() => loginForm.classList.remove('error'), 500);
            return;
        }
        
        // Show loading state
        const submitBtn = loginForm.querySelector('[type="submit"]');
        const originalText = submitBtn.textContent;
        submitBtn.textContent = 'Logging in...';
        submitBtn.disabled = true;
        
        // Simulate API call with setTimeout
        setTimeout(() => {
            // This would be replaced with actual authentication logic
            console.log(`Login attempt - Email: ${email}, Role: ${role}`);
            
            // For demo purposes, always show success
            showFormMessage(loginForm, 'Login successful! Redirecting...', 'success');
            
            // Reset button
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
            
            // Simulate redirect after successful login
            setTimeout(() => {
                closeModal();
                // Would redirect to dashboard in a real app
                alert(`Successfully logged in as ${role}`);
            }, 1500);
        }, 1000);
    });

    registerForm.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const name = registerForm.querySelector('#register-name').value;
        const email = registerForm.querySelector('#register-email').value;
        const password = registerForm.querySelector('#register-password').value;
        const role = registerForm.querySelector('.role-btn.active').getAttribute('data-role');
        const agreeTerms = registerForm.querySelector('#agree-terms').checked;
        
        // Simple validation
        if (!name || !email || !password) {
            showFormMessage(registerForm, 'Please fill in all required fields', 'error');
            registerForm.classList.add('error');
            setTimeout(() => registerForm.classList.remove('error'), 500);
            return;
        }
        
        if (!agreeTerms) {
            showFormMessage(registerForm, 'You must agree to the terms and conditions', 'error');
            return;
        }
        
        // Teacher-specific validation
        if (role === 'teacher') {
            const institution = registerForm.querySelector('#register-institution').value;
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
        
        // Simulate API call
        setTimeout(() => {
            // This would be replaced with actual registration logic
            console.log(`Register attempt - Name: ${name}, Email: ${email}, Role: ${role}`);
            
            // For demo purposes, always show success
            showFormMessage(registerForm, 'Account created successfully!', 'success');
            
            // Reset button
            submitBtn.textContent = originalText;
            submitBtn.disabled = false;
            
            // Simulate redirect after successful registration
            setTimeout(() => {
                closeModal();
                // Would redirect to dashboard in a real app
                alert(`Account created successfully as ${role}`);
            }, 1500);
        }, 1000);
    });

    // Helper function to show form messages
    function showFormMessage(form, message, type) {
        // Check if a message element already exists
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
        if (type === 'error') {
            setTimeout(() => {
                messageElement.style.display = 'none';
            }, 5000);
        }
    }
});

// Initialize future animated elements when they're added to the page
function initAnimations() {
    const fadeInElements = document.querySelectorAll('.fade-in:not(.observed)');
    
    const fadeInObserver = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('visible');
                fadeInObserver.unobserve(entry.target);
            }
        });
    }, {
        threshold: 0.2,
        rootMargin: '0px 0px -100px 0px'
    });
    
    fadeInElements.forEach(element => {
        element.classList.add('observed');
        fadeInObserver.observe(element);
    });
} 