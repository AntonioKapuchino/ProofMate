// Debug timestamp to verify file loading
console.log("Loading app.js - " + new Date().toISOString() + " - contains delete functionality");

// Global config
const API_BASE_URL = 'http://localhost:8000/api';

// Глобальные переменные для работы с аутентификацией
let isLoggedIn = false;
let currentUser = null;

// Добавим хранилище для заданий и решений
let assignments = [];
let submissions = [];

// Prevent infinite redirect loops
let isRedirecting = false;

// DIRECT EMERGENCY FIX: Check for localStorage access issues
function checkLocalStorageAccess() {
    try {
        console.log("%c TESTING LOCALSTORAGE ACCESS %c", 'background: orange; color: black; font-weight: bold;', '');
        
        // Try to write to localStorage
        localStorage.setItem('_test', 'working');
        // Try to read from localStorage
        const testValue = localStorage.getItem('_test');
        // Clean up
        localStorage.removeItem('_test');
        
        console.log(`LocalStorage write/read test: ${testValue === 'working' ? 'SUCCESS' : 'FAILED'}`);
        
        // Verify current state of assignments and submissions in localStorage
        try {
            console.log("Current assignments in localStorage:", 
                JSON.parse(localStorage.getItem('demoAssignments') || '[]').length);
            console.log("Current submissions in localStorage:", 
                JSON.parse(localStorage.getItem('demoSubmissions') || '[]').length);
        } catch (e) {
            console.error("Error parsing localStorage data:", e);
        }
        
        return testValue === 'working';
    } catch (e) {
        console.error("LocalStorage access error:", e);
        return false;
    }
}

// Run test immediately
if (!checkLocalStorageAccess()) {
    console.error("CRITICAL: LocalStorage not accessible!");
}

// Функция для синхронизации данных между панелями преподавателя и студента
function syncAssignmentsAndSubmissions() {
    console.log("%c Synchronizing assignments and submissions data... %c", 'background: blue; color: white; font-weight: bold;', '');
    
    // EMERGENCY FIX: Check if we need to force-reset the data
    const forceReset = () => {
        console.warn("EMERGENCY FIX: Force resetting assignments and submissions");
        
        // Generate demo data
        const demoAssignments = getDemoAssignments();
        const demoSubmissions = getDemoSubmissions();
        
        // Force save to localStorage
        try {
            // Clear old data first
            localStorage.removeItem('assignments');
            localStorage.removeItem('submissions');
            localStorage.removeItem('demoAssignments');
            localStorage.removeItem('demoSubmissions');
            
            // Set new data with consistent keys
            localStorage.setItem('demoAssignments', JSON.stringify(demoAssignments));
            localStorage.setItem('demoSubmissions', JSON.stringify(demoSubmissions));
            
            // Update memory arrays
            assignments = demoAssignments;
            submissions = demoSubmissions;
            
            console.log("Force reset complete with:", 
                demoAssignments.length, "assignments and", 
                demoSubmissions.length, "submissions");
                
            return true;
        } catch (e) {
            console.error("Error during force reset:", e);
            return false;
        }
    };
    
    // FIX: Check for submissions saved with inconsistent key names
    const fixKeys = () => {
        // Check if we have data in 'submissions' but not in 'demoSubmissions'
        const oldSubmissions = localStorage.getItem('submissions');
        if (oldSubmissions && !localStorage.getItem('demoSubmissions')) {
            console.log("Found submissions with old key, migrating to demoSubmissions");
            localStorage.setItem('demoSubmissions', oldSubmissions);
        }
        
        // Check if we have data in 'assignments' but not in 'demoAssignments'
        const oldAssignments = localStorage.getItem('assignments');
        if (oldAssignments && !localStorage.getItem('demoAssignments')) {
            console.log("Found assignments with old key, migrating to demoAssignments");
            localStorage.setItem('demoAssignments', oldAssignments);
        }
        
        // Ensure we're using the correct keys for future operations
        return {
            assignmentsKey: 'demoAssignments',
            submissionsKey: 'demoSubmissions'
        };
    };
    
    // Fix any key inconsistencies
    const storageKeys = fixKeys();
    
    // Debugging - check localStorage contents directly
    const localStorageDebug = {};
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        try {
            localStorageDebug[key] = JSON.parse(localStorage.getItem(key));
        } catch (e) {
            localStorageDebug[key] = localStorage.getItem(key);
        }
    }
    console.log('Current localStorage contents:', localStorageDebug);
    
    // Ensure we have a current user before proceeding
    if (!currentUser) {
        console.warn("Cannot sync data - no current user");
        return;
    }
    
    console.log("Current user:", currentUser.name, "with role:", currentUser.role);
    
    // Check if we need to force reset the data
    const storedAssignmentsCount = JSON.parse(localStorage.getItem(storageKeys.assignmentsKey) || '[]').length;
    const storedSubmissionsCount = JSON.parse(localStorage.getItem(storageKeys.submissionsKey) || '[]').length;
    
    // If there's no data at all, force a reset
    // Сначала получаем сохраненные задания
    const savedAssignments = localStorage.getItem(storageKeys.assignmentsKey);
    if (savedAssignments) {
        try {
            assignments = JSON.parse(savedAssignments);
            console.log(`Loaded ${assignments.length} assignments from localStorage:`, assignments);
        } catch (e) {
            console.error("Error parsing assignments from localStorage:", e);
            assignments = getDemoAssignments();
            localStorage.setItem(storageKeys.assignmentsKey, JSON.stringify(assignments));
        }
    } else {
        // Если нет сохраненных заданий, создаем демо-данные
        assignments = getDemoAssignments();
        localStorage.setItem(storageKeys.assignmentsKey, JSON.stringify(assignments));
        console.log(`Created and saved ${assignments.length} demo assignments`);
    }
    
    // Затем получаем сохраненные решения
    const savedSubmissions = localStorage.getItem(storageKeys.submissionsKey);
    if (savedSubmissions) {
        try {
            submissions = JSON.parse(savedSubmissions);
            console.log(`Loaded ${submissions.length} submissions from localStorage:`, submissions);
        } catch (e) {
            console.error("Error parsing submissions from localStorage:", e);
            submissions = getDemoSubmissions();
            localStorage.setItem(storageKeys.submissionsKey, JSON.stringify(submissions));
        }
    } else {
        // Если нет сохраненных решений, создаем демо-данные
        submissions = getDemoSubmissions();
        localStorage.setItem(storageKeys.submissionsKey, JSON.stringify(submissions));
        console.log(`Created and saved ${submissions.length} demo submissions`);
    }
    
    console.log("%c Data synchronization complete %c", 'background: green; color: white; font-weight: bold;', '');
    return { assignments, submissions };
}

// Функция для проверки статуса авторизации
function checkAuthStatus() {
    // Если уже выполняется перенаправление, прерываем выполнение
    if (isRedirecting) return;
    
    console.log("Checking auth status...");
    
    // Получаем значения из localStorage и устанавливаем глобальные переменные
    isLoggedIn = localStorage.getItem('isLoggedIn') === 'true';
    const currentUserRole = localStorage.getItem('userRole');
    
    // Если пользователь авторизован, обновляем объект currentUser
    if (isLoggedIn) {
        const userName = localStorage.getItem('userName');
        const userEmail = localStorage.getItem('userEmail');
        currentUser = {
            name: userName,
            email: userEmail,
            role: currentUserRole
        };
        
        console.log("Current user from localStorage:", currentUser);
    
    // Определяем, на какой странице мы находимся
        const fullPath = window.location.pathname;
        const pathParts = fullPath.split('/');
        const currentPage = pathParts[pathParts.length - 1] || 'index.html';
    
        console.log(`Current page: ${currentPage}, isLoggedIn: ${isLoggedIn}, userRole: ${currentUserRole}`);
        
        // Define which pages should be restricted and redirected
        const restrictedPages = ['index.html', 'student-dashboard.html', 'teacher-dashboard.html'];
        const allowedPages = ['submit-solution.html', 'analysis-report.html'];
        
        // Skip all redirection for certain pages that should be accessible regardless of role
        if (allowedPages.includes(currentPage)) {
            console.log(`${currentPage} is freely accessible, skipping auth redirection`);
            // Still update user info for these pages
            updateUserInfo();
            return;
        }
        
        // If user is on the login page (index.html) and already logged in, redirect to appropriate dashboard
        if (currentPage === 'index.html') {
            isRedirecting = true;
            if (currentUserRole === 'teacher') {
                console.log("Redirecting to teacher dashboard...");
                window.location.href = 'teacher-dashboard.html';
            } else {
                console.log("Redirecting to student dashboard...");
                window.location.href = 'student-dashboard.html';
            }
            return; // Прерываем выполнение функции после перенаправления
        }
        
        // Only check role-specific restrictions for dashboard pages, not other utility pages
        if (currentPage === 'student-dashboard.html' && currentUserRole !== 'student') {
            isRedirecting = true;
            console.log("User is a teacher on student page, redirecting...");
            window.location.href = 'teacher-dashboard.html';
            return;
        } else if (currentPage === 'teacher-dashboard.html' && currentUserRole !== 'teacher') {
            isRedirecting = true;
            console.log("User is a student on teacher page, redirecting...");
            window.location.href = 'student-dashboard.html';
            return;
        }
        
        // Если пользователь на правильной странице, обновляем информацию и загружаем данные
            updateUserInfo();
            
            // Обработчик для кнопки выхода
        const logoutBtn = document.getElementById('logoutBtn');
            if (logoutBtn) {
                logoutBtn.addEventListener('click', logout);
            }
            
            // Загружаем данные для текущей страницы
            if (currentPage === 'student-dashboard.html') {
                loadStudentDashboard();
            } else if (currentPage === 'teacher-dashboard.html') {
                loadTeacherDashboard();
            } else if (currentPage === 'submit-solution.html') {
                loadSubmissionPage();
        }
    } else {
        // Если пользователь не авторизован и не на главной странице
        if (currentPage !== 'index.html') {
            isRedirecting = true;
            console.log("User not logged in, redirecting to index.html...");
            window.location.href = 'index.html';
            return;
        } else {
            // Настраиваем обработчики для кнопок аутентификации на главной странице
            setupAuthHandlers();
        }
    }
    
    console.log("Auth check completed without redirects");
}

// Функция для настройки обработчиков аутентификации на главной странице
function setupAuthHandlers() {
    const loginButtons = document.querySelectorAll('.login-btn');
    const registerButtons = document.querySelectorAll('.register-btn');
    const authModal = document.getElementById('authModal');
    const authModalClose = document.getElementById('authModalClose');
    const loginTab = document.getElementById('loginTab');
    const registerTab = document.getElementById('registerTab');
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    
    // Обработчики для открытия модального окна
    loginButtons.forEach(button => {
        button.addEventListener('click', () => {
            authModal.classList.add('active');
            loginTab.classList.add('active');
            registerTab.classList.remove('active');
            loginForm.classList.add('active');
            registerForm.classList.remove('active');
        });
    });
    
    registerButtons.forEach(button => {
        button.addEventListener('click', () => {
            authModal.classList.add('active');
            loginTab.classList.remove('active');
            registerTab.classList.add('active');
            loginForm.classList.remove('active');
            registerForm.classList.add('active');
        });
    });
    
    // Обработчик для закрытия модального окна
    if (authModalClose) {
        authModalClose.addEventListener('click', () => {
            authModal.classList.remove('active');
        });
    }
    
    // Обработчики для переключения между вкладками
    if (loginTab && registerTab) {
        loginTab.addEventListener('click', () => {
            loginTab.classList.add('active');
            registerTab.classList.remove('active');
            loginForm.classList.add('active');
            registerForm.classList.remove('active');
        });
        
        registerTab.addEventListener('click', () => {
            loginTab.classList.remove('active');
            registerTab.classList.add('active');
            loginForm.classList.remove('active');
            registerForm.classList.add('active');
        });
    }
    
    // Обработчики для форм аутентификации
    if (loginForm) {
        loginForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const email = document.getElementById('loginEmail').value;
            const password = document.getElementById('loginPassword').value;
            const role = document.querySelector('input[name="loginRole"]:checked').value;
            
            // Имитация проверки на сервере
            setTimeout(() => {
                // В демо-версии просто проверяем, что поля не пусты
                if (email && password) {
                    login(email, password, role);
                    authModal.classList.remove('active');
                } else {
                    alert('Please fill in all fields');
                }
            }, 1000);
        });
    }
    
    if (registerForm) {
        registerForm.addEventListener('submit', function(e) {
            e.preventDefault();
            const name = document.getElementById('registerName').value;
            const email = document.getElementById('registerEmail').value;
            const password = document.getElementById('registerPassword').value;
            const confirmPassword = document.getElementById('registerConfirmPassword').value;
            const role = document.querySelector('input[name="registerRole"]:checked').value;
            const terms = document.getElementById('termsCheckbox').checked;
            
            // Проверка полей
            if (!name || !email || !password || !confirmPassword) {
                alert('Please fill in all fields');
                return;
            }
            
            if (password !== confirmPassword) {
                alert('Passwords do not match');
                return;
            }
            
            if (!terms) {
                alert('You must agree to the terms and conditions');
                return;
            }
            
            // Имитация регистрации на сервере
            setTimeout(() => {
                register(email, role, name);
                authModal.classList.remove('active');
            }, 1000);
        });
    }
}

// Функция для загрузки панели управления студента
function loadStudentDashboard() {
    console.log("Loading student dashboard...");
    
    // Make sure user info is updated first
    updateUserInfo();
    
    // Принудительно синхронизируем данные
    syncAssignmentsAndSubmissions();
    
    // Validate current user
    if (!currentUser || !currentUser.email) {
        console.error("Cannot load student dashboard - invalid user data", currentUser);
        // Still try to continue with default student email
        currentUser = currentUser || {};
        currentUser.email = currentUser.email || 'student@example.com';
    }
    
    // Фильтруем данные для текущего студента
    const studentEmail = currentUser.email;
    console.log(`Filtering submissions for student email: ${studentEmail}`);
    
    // Make sure we have valid arrays
    if (!Array.isArray(submissions)) {
        console.error("Submissions is not an array", submissions);
        submissions = [];
    }
    
    if (!Array.isArray(assignments)) {
        console.error("Assignments is not an array", assignments);
        assignments = [];
    }
    
    const studentSubmissions = submissions.filter(sub => sub.studentEmail === studentEmail);
    
    // Получаем доступные для студента задания (все, кроме тех, на которые уже есть решения)
    const submittedAssignmentIds = studentSubmissions.map(sub => sub.assignmentId);
    const availableAssignments = assignments.filter(assignment => !submittedAssignmentIds.includes(assignment.id));
    
    // Для отладки: выводим все задания и те, которые доступны для этого студента
    console.log("All assignments:", assignments);
    console.log(`Student has ${studentSubmissions.length} submissions and ${availableAssignments.length} available assignments`);
    console.log("Available assignments for student:", availableAssignments);
    
    // Update the dashboard stats with real data
    updateStudentDashboardStats(studentSubmissions, availableAssignments);
    
    // Отображаем загруженные данные на странице
    updateStudentAssignmentsList(availableAssignments);
    updateStudentSubmissionsList(studentSubmissions);
    
    // Настраиваем обработчики событий
    setupStudentDashboardEventHandlers();
    
    console.log("Student dashboard loaded successfully");
}

// Function to update student dashboard stats based on real data
function updateStudentDashboardStats(studentSubmissions = [], availableAssignments = []) {
    console.log("Updating student dashboard stats with real data");
    
    try {
        // Get current user email
        const studentEmail = currentUser?.email || 'student@example.com';
        
        // If student submissions not provided, get them now
        if (!Array.isArray(studentSubmissions) || studentSubmissions.length === 0) {
            studentSubmissions = submissions.filter(sub => sub.studentEmail === studentEmail);
        }
        
        // If available assignments not provided, calculate them
        if (!Array.isArray(availableAssignments)) {
            const submittedAssignmentIds = studentSubmissions.map(sub => sub.assignmentId);
            availableAssignments = assignments.filter(assignment => !submittedAssignmentIds.includes(assignment.id));
        }
        
        console.log(`Calculating student stats with ${studentSubmissions.length} submissions and ${availableAssignments.length} available assignments`);
        
        // 1. Total assignments (all assignments in the system)
        const totalAssignments = assignments.length;
        
        // 2. Completed assignments (submissions that have been reviewed with score)
        const completedCount = studentSubmissions.filter(s => 
            s.status === 'reviewed' || (s.score !== null && s.score !== undefined)
        ).length;
        
        // 3. In-progress assignments (available assignments plus pending submissions)
        const pendingSubmissions = studentSubmissions.filter(s => 
            s.status !== 'reviewed' && (s.score === null || s.score === undefined)
        );
        const inProgressCount = availableAssignments.length + pendingSubmissions.length;
        
        // 4. Calculate average score from reviewed submissions
        const reviewedSubmissions = studentSubmissions.filter(s => 
            s.score !== null && s.score !== undefined && !isNaN(parseFloat(s.score))
        );
        
        let avgScore = 0;
        if (reviewedSubmissions.length > 0) {
            const totalScore = reviewedSubmissions.reduce((sum, s) => 
                sum + parseFloat(s.score), 0
            );
            avgScore = (totalScore / reviewedSubmissions.length).toFixed(1);
        }
        
        console.log("Student stats calculated:", {
            totalAssignments,
            completedCount,
            inProgressCount,
            avgScore,
            reviewedSubmissions: reviewedSubmissions.length
        });
        
        // Update the UI elements
        const statCards = document.querySelectorAll('.stat-card-value');
        if (statCards.length >= 4) {
            statCards[0].textContent = totalAssignments;   // Total Assignments
            statCards[1].textContent = completedCount;     // Completed
            statCards[2].textContent = inProgressCount;    // In Progress
            statCards[3].textContent = avgScore;           // Avg. Grade
            
            // Also update the welcome message with the number of upcoming assignments
            const welcomeMessage = document.querySelector('.welcome-message');
            if (welcomeMessage) {
                const upcomingCount = availableAssignments.length;
                welcomeMessage.innerHTML = welcomeMessage.innerHTML.replace(
                    /You have \d+ upcoming assignments due this week\./,
                    `You have ${upcomingCount} upcoming assignments due this week.`
                );
            }
            
            console.log("Student dashboard stats updated successfully");
        } else {
            console.error("Could not find all stat card elements:", statCards.length);
        }
        
    } catch (error) {
        console.error("Error updating student dashboard stats:", error);
    }
}

// Функция для обновления списка заданий на странице студента
function updateStudentAssignmentsList(availableAssignments) {
    console.log("Updating assignments list for student...");
    
    const assignmentsList = document.querySelector('.student-assignments-list');
    if (!assignmentsList) {
        console.error("Student assignments list container not found");
        return;
    }
    
    // Очищаем текущий список
    assignmentsList.innerHTML = '';
    
    if (!Array.isArray(availableAssignments) || availableAssignments.length === 0) {
        assignmentsList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-tasks"></i>
                <p>No assignments available. Check back later!</p>
            </div>
        `;
        console.log("No available assignments found, displaying empty state");
        return;
    }
    
    console.log(`Displaying ${availableAssignments.length} available assignments for student`);
    
    // Выводим доступные задания для студента
    availableAssignments.forEach(assignment => {
        // Форматируем дату
        let dueDateStr = 'N/A';
        let dueStatus = '';
        let dueDateLabel = '';
        
        try {
            if (assignment.dueDate) {
        const dueDate = new Date(assignment.dueDate);
                if (!isNaN(dueDate.getTime())) {
                    dueDateStr = dueDate.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric' 
        });
        
                    const now = new Date();
                    const diffDays = Math.ceil((dueDate - now) / (1000 * 60 * 60 * 24));
                    
                    if (diffDays < 0) {
                        dueStatus = '<span class="status-badge overdue">Overdue</span>';
                        dueDateLabel = 'Overdue';
                    } else if (diffDays === 0) {
                        dueStatus = '<span class="status-badge active">Due Today</span>';
                        dueDateLabel = 'Due Today';
                    } else if (diffDays === 1) {
                        dueStatus = '<span class="status-badge active">Due Tomorrow</span>';
                        dueDateLabel = 'Due Tomorrow';
                    } else if (diffDays <= 7) {
                        dueStatus = '<span class="status-badge active">Due in ' + diffDays + ' days</span>';
                        dueDateLabel = `Due in ${diffDays} days`;
                    } else {
                        dueStatus = '<span class="status-badge active">Active</span>';
                        dueDateLabel = `Due in ${diffDays} days`;
                    }
                }
            }
        } catch (e) {
            console.error(`Error formatting date for assignment ${assignment.id}:`, e);
        }
        
        // Создаем карточку задания
        const assignmentCard = document.createElement('div');
        assignmentCard.className = 'assignment-card';
        assignmentCard.dataset.assignmentId = assignment.id;
        
        assignmentCard.innerHTML = `
            <div class="assignment-header">
                <h3 class="assignment-title">${assignment.title}</h3>
                <span class="due-date">${dueDateLabel}</span>
            </div>
            <p class="assignment-description">${assignment.description || 'No description provided'}</p>
            <div class="assignment-info">
                <span class="due-date"><i class="fas fa-calendar"></i> Due: ${dueDateStr}</span>
                <span class="points"><i class="fas fa-star"></i> Max Points: ${assignment.maxPoints || 10}</span>
            </div>
            <div class="assignment-actions">
                <div class="assignment-details">
                    <button class="btn btn-outline details-btn" data-assignment-id="${assignment.id}">View Details</button>
                </div>
                <button class="upload-btn submit-solution-btn" data-assignment-id="${assignment.id}">
                    <i class="fas fa-cloud-upload-alt"></i> Submit Solution
                </button>
            </div>
        `;
        
        assignmentsList.appendChild(assignmentCard);
    });
    
    // Set up event listeners for the submission buttons
    document.querySelectorAll('.submit-solution-btn').forEach(btn => {
        btn.addEventListener('click', function(e) {
            e.preventDefault();
            const assignmentId = this.getAttribute('data-assignment-id');
            console.log(`Submit button clicked for assignment ID: ${assignmentId}`);
            
            // Option 1: Open the submission modal directly
            const submitModal = document.getElementById('submitAssignmentModal');
            if (submitModal) {
                const form = document.getElementById('submitAssignmentForm');
                if (form) {
                    form.dataset.assignmentId = assignmentId;
                    submitModal.classList.add('active');
                    console.log(`Modal opened for assignment ID: ${assignmentId}`);
                } else {
                    console.error('Submit form not found in modal');
                }
            } else {
                // Option 2: Redirect to the submission page
                console.log(`Redirecting to submission page for assignment ID: ${assignmentId}`);
            window.location.href = `submit-solution.html?id=${assignmentId}`;
            }
        });
    });
    
    console.log("Student assignments list updated successfully");
}

// Функция для обновления списка сданных заданий на странице студента
function updateStudentSubmissionsList(studentSubmissions) {
    console.log("Updating student submissions list...");
    
    const submissionsList = document.querySelector('.student-submissions-list');
    if (!submissionsList) {
        console.error("Student submissions list container not found");
        return;
    }
    
    // Очищаем текущий список
    submissionsList.innerHTML = '';
    
    if (studentSubmissions.length === 0) {
        submissionsList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-file-alt"></i>
                <p>You have not submitted any assignments yet.</p>
            </div>
        `;
        console.log("No submissions found, displaying empty state");
        return;
    }
    
    console.log(`Displaying ${studentSubmissions.length} submissions for student`);
    
    // Сортируем по дате отправки (сначала новые)
    studentSubmissions.sort((a, b) => new Date(b.submittedAt) - new Date(a.submittedAt));
    
    // Выводим отправки студента
    studentSubmissions.forEach(submission => {
        console.log("Processing submission:", submission);
        
        // Находим соответствующее задание
        const assignment = assignments.find(a => a.id === submission.assignmentId);
        if (!assignment) {
            console.error(`Assignment not found for submission ${submission.id}`);
            return;
        }
        
        // Определяем статус
        let statusBadge = '';
        switch (submission.status) {
            case 'pending':
                statusBadge = '<span class="status-badge pending">Pending Review</span>';
                break;
            case 'reviewed':
                statusBadge = '<span class="status-badge completed">Reviewed</span>';
                break;
            default:
                statusBadge = '<span class="status-badge">Unknown</span>';
        }
        
        // Создаем карточку отправки
        const submissionCard = document.createElement('div');
        submissionCard.className = 'submission-card';
        
        submissionCard.innerHTML = `
            <div class="submission-header">
                <div class="submission-title">${assignment.title}</div>
                <div class="submission-status">${statusBadge}</div>
            </div>
            <div class="submission-details">
                <div class="submission-detail">
                    <i class="fas fa-calendar"></i>
                    <span>Submitted: ${new Date(submission.submittedAt).toLocaleDateString()}</span>
                </div>
                <div class="submission-detail">
                    <i class="fas fa-file-code"></i>
                    <span>Solution: ${submission.solutionFile || 'No file'}</span>
                </div>
                ${submission.status === 'reviewed' ? `
                    <div class="submission-detail score">
                        <i class="fas fa-star"></i>
                        <span>Score: ${submission.score}/10</span>
                    </div>
                ` : ''}
            </div>
            <div class="submission-actions">
                <button class="btn btn-secondary view-submission-btn" data-id="${submission.id}">
                    View Details
                </button>
            </div>
        `;
        
        submissionsList.appendChild(submissionCard);
    });
    
    // Добавляем обработчики для кнопок просмотра
    document.querySelectorAll('.view-submission-btn').forEach(btn => {
        btn.addEventListener('click', function() {
            const submissionId = parseInt(this.getAttribute('data-id'));
            // Находим решение
            const submission = studentSubmissions.find(s => s.id === submissionId);
            if (submission) {
                // Находим соответствующее задание
                const assignment = assignments.find(a => a.id === submission.assignmentId);
                
                // Открываем модальное окно и заполняем данными
                const modal = document.getElementById('viewSubmissionModal');
                if (modal) {
            modal.classList.add('active');
                    document.getElementById('viewSubmissionTitle').textContent = assignment.title;
                    document.getElementById('viewSubmissionDate').textContent = new Date(submission.submittedAt).toLocaleDateString();
                    document.getElementById('viewSubmissionFile').textContent = submission.solutionFile || 'No file';
                    document.getElementById('viewSubmissionNotes').textContent = submission.notes || 'No notes provided';
                    
                    // Отображаем или скрываем блок с оценкой
                    const scoreContainer = document.getElementById('viewSubmissionScoreContainer');
                    if (submission.status === 'reviewed') {
                        scoreContainer.style.display = 'block';
                        document.getElementById('viewSubmissionScore').textContent = `${submission.score || 'N/A'}/10`;
                        document.getElementById('viewSubmissionConfidence').textContent = `${submission.aiConfidence || 'N/A'}%`;
                        document.querySelector('.feedback-content').textContent = submission.feedback || 'No feedback provided.';
                    } else {
                        scoreContainer.style.display = 'none';
                    }
                }
            }
        });
    });
}

// Функция для загрузки панели управления преподавателя
function loadTeacherDashboard() {
    console.log("%c LOADING TEACHER DASHBOARD - INIT %c", 'background: purple; color: white; font-weight: bold;', '');
    
    // First, check if we need to initialize demo data
    ensureTestDataExists();
    
    // Force reload data from localStorage to ensure we have the latest data
    try {
        console.log("Loading latest data from localStorage");
        
        // Clear memory arrays
        assignments = [];
        submissions = [];
        
        // Load from localStorage with consistent keys
        const savedAssignments = localStorage.getItem('demoAssignments');
        if (savedAssignments) {
            assignments = JSON.parse(savedAssignments);
            console.log(`Loaded ${assignments.length} assignments from localStorage`);
        } else {
            // If no assignments in localStorage, create demo data
            assignments = getDemoAssignments();
            localStorage.setItem('demoAssignments', JSON.stringify(assignments));
            console.log(`Generated and saved ${assignments.length} demo assignments`);
        }
        
        const savedSubmissions = localStorage.getItem('demoSubmissions');
        if (savedSubmissions) {
            submissions = JSON.parse(savedSubmissions);
            console.log(`Loaded ${submissions.length} submissions from localStorage`);
        } else {
            // If no submissions in localStorage, create demo data
            submissions = getDemoSubmissions();
            localStorage.setItem('demoSubmissions', JSON.stringify(submissions));
            console.log(`Generated and saved ${submissions.length} demo submissions`);
        }
        
        // Sort assignments by ID for consistency
        assignments.sort((a, b) => a.id - b.id);
    
        // Immediately update the dashboard stats with real data
        updateTeacherDashboardStats();
        
    } catch (e) {
        console.error("Error loading data from localStorage:", e);
        // Fallback to sync function if direct loading fails
        syncAssignmentsAndSubmissions();
        updateTeacherDashboardStats();
    }
    
    // Отображаем загруженные данные на странице
    console.log("Updating assignments list...");
    updateAssignmentsList();
    console.log("Updating submissions list...");
    updateSubmissionsList();
                
    // Настраиваем обработчики событий
    console.log("Setting up teacher dashboard event handlers...");
    setupTeacherDashboardEventHandlers();
    
    console.log("%c TEACHER DASHBOARD LOADING COMPLETE %c", 'background: green; color: white; font-weight: bold;', '');
}

// New function to update dashboard stats based on real data
function updateTeacherDashboardStats() {
    console.log("Updating teacher dashboard stats with real data");
    
    try {
        // Check if we have access to the required data
        if (!Array.isArray(assignments) || !Array.isArray(submissions)) {
            console.error("Missing assignments or submissions arrays");
            return;
        }
        
        // 1. Total assignments
        const totalAssignments = assignments.length;
        
        // 2. Pending reviews (submissions that haven't been reviewed)
        const pendingReviews = submissions.filter(s => 
            s.status === 'pending' || 
            !s.feedback || 
            s.score === null || 
            s.score === undefined
        ).length;
        
        // 3. Get unique students count
        const uniqueStudents = new Set();
        submissions.forEach(s => {
            if (s.studentEmail) uniqueStudents.add(s.studentEmail);
            else if (s.studentId) uniqueStudents.add(s.studentId);
            else if (s.studentName) uniqueStudents.add(s.studentName);
        });
        const activeStudents = uniqueStudents.size;
        
        // 4. Calculate average score from reviewed submissions
        const reviewedSubmissions = submissions.filter(s => 
            s.score !== null && 
            s.score !== undefined && 
            !isNaN(parseFloat(s.score))
        );
        
        let avgScore = 0;
        if (reviewedSubmissions.length > 0) {
            const totalScore = reviewedSubmissions.reduce((sum, s) => 
                sum + parseFloat(s.score), 0
            );
            avgScore = (totalScore / reviewedSubmissions.length).toFixed(1);
        }
        
        console.log("Stats calculated:", {
            totalAssignments,
            pendingReviews,
            activeStudents,
            avgScore,
            reviewedSubmissions: reviewedSubmissions.length
        });
        
        // Update the UI elements
        const statCards = document.querySelectorAll('.stat-card-value');
        if (statCards.length >= 4) {
            statCards[0].textContent = totalAssignments;  // Assignments
            statCards[1].textContent = pendingReviews;    // Pending Reviews
            statCards[2].textContent = activeStudents;    // Students
            statCards[3].textContent = avgScore;          // Avg. Score
            
            console.log("Dashboard stats updated successfully");
        } else {
            console.error("Could not find all stat card elements:", statCards.length);
        }
        
    } catch (error) {
        console.error("Error updating dashboard stats:", error);
    }
}

// Function to ensure test data exists for debugging
function ensureTestDataExists() {
    console.log("%c CHECKING FOR TEST DATA %c", 'background: purple; color: white; font-weight: bold;', '');
    
    // Check localStorage directly
    try {
        const storedAssignments = JSON.parse(localStorage.getItem('demoAssignments') || '[]');
        const storedSubmissions = JSON.parse(localStorage.getItem('demoSubmissions') || '[]');
        
        console.log(`Found ${storedAssignments.length} assignments and ${storedSubmissions.length} submissions in localStorage`);
        
        // If no assignments in localStorage, create a test assignment
        if (storedAssignments.length === 0) {
            console.warn("No assignments found in localStorage, adding a test assignment");
            
            // Create test assignment
            const testAssignment = {
                id: 1,
                title: "Test Assignment",
                description: "This is a test assignment created automatically",
                dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 1 week from now
                perfectSolution: "test_solution.ipynb",
                createdAt: new Date().toISOString(),
                createdBy: 'teacher@example.com',
                maxPoints: 10,
                submissionsCount: 0,
                reviewedCount: 0
            };
            
            // Add to localStorage directly
            localStorage.setItem('demoAssignments', JSON.stringify([testAssignment]));
            console.log("Added test assignment to localStorage:", testAssignment);
            
            // Update global array
            assignments = [testAssignment];
        }
        
        // If no submissions, create a test submission for the first assignment
        if (storedSubmissions.length === 0 && storedAssignments.length > 0) {
            console.warn("No submissions found in localStorage, adding a test submission");
            
            // Create test submission
            const testSubmission = {
                id: 1,
                assignmentId: storedAssignments[0].id,
                studentId: 101,
                studentEmail: "student@example.com",
                studentName: "Test Student",
                submittedAt: new Date().toISOString(),
                solution: "Test solution content",
                solutionFile: "student_solution.ipynb",
                notes: "This is a test submission created automatically",
                status: "pending",
                score: null,
                aiConfidence: null,
                feedback: null
            };
            
            // Add to localStorage directly
            localStorage.setItem('demoSubmissions', JSON.stringify([testSubmission]));
            console.log("Added test submission to localStorage:", testSubmission);
            
            // Update global array
            submissions = [testSubmission];
            
            // Update the assignment's submission count
            storedAssignments[0].submissionsCount = 1;
            localStorage.setItem('demoAssignments', JSON.stringify(storedAssignments));
            
            // Update global array
            assignments = storedAssignments;
        }
        
    } catch (e) {
        console.error("Error checking/creating test data:", e);
    }
    
    console.log("%c TEST DATA CHECK COMPLETE %c", 'background: green; color: white; font-weight: bold;', '');
}

// Функция для обновления списка заданий в панели преподавателя
function updateAssignmentsList() {
    console.log("Updating assignments list for teacher...");
    
    // CRITICAL FIX: First ensure we have assignments data
    if (!assignments || assignments.length === 0) {
        console.warn("No assignments array or empty array, attempting to reload data");
        try {
            const storedAssignments = JSON.parse(localStorage.getItem('demoAssignments') || '[]');
            if (storedAssignments.length > 0) {
                assignments = storedAssignments;
                console.log("Successfully reloaded assignments from localStorage:", assignments.length);
            } else {
                console.warn("No assignments in localStorage, creating test data");
                ensureTestDataExists();
            }
        } catch (e) {
            console.error("Failed to reload assignments:", e);
            ensureTestDataExists();
        }
    }
    
    const assignmentsList = document.querySelector('.assignments-list');
    if (!assignmentsList) {
        console.error("Assignments list container not found");
        return;
    }
    
    // Очищаем текущий список
    assignmentsList.innerHTML = '';
    
    if (!assignments || assignments.length === 0) {
        assignmentsList.innerHTML = `
            <div class="empty-state">
                <i class="fas fa-tasks"></i>
                <p>No assignments yet. Create your first assignment!</p>
            </div>
        `;
        console.log("No assignments found, displaying empty state");
        return;
    }
    
    console.log(`Displaying ${assignments.length} assignments`);
    
    // Выводим задания
    assignments.forEach(assignment => {
        // SAFETY CHECK: Skip invalid assignments
        if (!assignment || typeof assignment !== 'object') {
            console.warn("Invalid assignment found, skipping:", assignment);
            return;
        }
        
        // Форматируем дату
        let dueDateStr = 'N/A';
        let dueStatus = '';
        
        try {
            if (assignment.dueDate) {
                const dueDate = new Date(assignment.dueDate);
                if (!isNaN(dueDate.getTime())) {
                    dueDateStr = dueDate.toLocaleDateString('en-US', { 
                        year: 'numeric', 
                        month: 'short', 
                        day: 'numeric' 
                    });
                
                    const now = new Date();
                    if (dueDate < now) {
                        dueStatus = 'Overdue';
                    } else {
                        dueStatus = 'Active';
                    }
                }
            }
        } catch (e) {
            console.error(`Error formatting date for assignment ${assignment.id}:`, e);
        }
        
        // Создаем карточку задания
        const assignmentCard = document.createElement('div');
        assignmentCard.className = 'assignment-card';
        
        // Определяем количество отправленных и проверенных работ
        const submissionsCount = assignment.submissionsCount || 0;
        const reviewedCount = assignment.reviewedCount || 0;
        
        assignmentCard.innerHTML = `
            <div class="assignment-header">
                <div class="assignment-title">${assignment.title || 'Untitled Assignment'}</div>
                <div class="assignment-stats">${submissionsCount} submissions / ${reviewedCount} reviewed</div>
            </div>
            <div class="assignment-description">${assignment.description || 'No description provided'}</div>
            <div class="assignment-details">
                <div class="assignment-detail">
                    <i class="fas fa-calendar"></i>
                    <span>Due: ${dueDateStr}</span>
                </div>
                <div class="assignment-detail">
                    <i class="fas fa-star"></i>
                    <span>Max Points: 10</span>
                </div>
                <div class="assignment-detail">
                    <i class="fas fa-file-code"></i>
                    <span>Solution: ${assignment.perfectSolution || 'Not provided'}</span>
                </div>
                <div class="assignment-detail">
                    <i class="fas fa-clock"></i>
                    <span>Status: ${dueStatus}</span>
                </div>
            </div>
            <div class="assignment-actions">
                <button class="btn btn-outline edit-btn" data-id="${assignment.id}">
                    <i class="fas fa-pencil-alt"></i> Edit
                </button>
                <button class="btn btn-primary view-submissions-btn" data-id="${assignment.id}">
                    <i class="fas fa-eye"></i> View Submissions
                </button>
                <button class="btn btn-danger delete-assignment-btn" style="background-color: red; color: white; font-weight: bold;" data-id="${assignment.id}">
                    <i class="fas fa-trash"></i> DELETE
                </button>
            </div>
        `;
        
        assignmentsList.appendChild(assignmentCard);
    });
    
    // Add event listeners for the delete buttons
    document.querySelectorAll('.delete-assignment-btn').forEach(button => {
        button.addEventListener('click', function() {
            const assignmentId = parseInt(this.getAttribute('data-id'));
            
            // Confirm before deleting
            if (confirm('Are you sure you want to delete this assignment? This will also delete all student submissions for this assignment and cannot be undone.')) {
                // Call the delete function
                if (deleteAssignment(assignmentId)) {
                    alert('Assignment deleted successfully');
                    // Update dashboard stats after deletion
                    updateTeacherDashboardStats();
                } else {
                    alert('Failed to delete assignment. Please try again.');
                }
            }
        });
    });
    
    // Add event listeners for the view submissions buttons
    document.querySelectorAll('.view-submissions-btn').forEach(button => {
        button.addEventListener('click', function() {
            const assignmentId = parseInt(this.getAttribute('data-id'));
            
            console.log(`%c View Submissions button clicked for assignment ${assignmentId} %c`, 'background: green; color: white; font-weight: bold;', '');
            
            // Explicitly reload submissions from localStorage
            try {
                const storedSubmissions = JSON.parse(localStorage.getItem('demoSubmissions') || '[]');
                if (storedSubmissions.length > 0) {
                    submissions = storedSubmissions;
                    console.log(`Successfully reloaded ${submissions.length} submissions from localStorage`);
                } else {
                    console.warn("No submissions found in localStorage");
                    submissions = [];
                }
            } catch (e) {
                console.error("Failed to reload submissions:", e);
                submissions = [];
            }
            
            // Filter submissions for this assignment
            const assignmentSubmissions = submissions.filter(s => s && s.assignmentId === assignmentId);
            console.log(`Found ${assignmentSubmissions.length} submissions for assignment ${assignmentId}:`, assignmentSubmissions);
            
            if (assignmentSubmissions.length === 0) {
                alert('No submissions for this assignment yet.');
                return;
            }
            
            // Scroll to submissions section
            const reviewsSection = document.querySelector('.reviews-section');
            if (reviewsSection) {
                // Update the submissions list with only submissions for this assignment
                updateSubmissionsList(assignmentId);
                
                // Scroll to the submissions list
                reviewsSection.scrollIntoView({ behavior: 'smooth' });
            } else {
                alert('Submissions section not found.');
            }
        });
    });
    
    // Explicitly verify delete buttons were created
    const deleteButtons = document.querySelectorAll('.delete-assignment-btn');
    console.log(`%c Found ${deleteButtons.length} delete buttons %c`, 'background: orange; color: black; font-weight: bold;', '');
    deleteButtons.forEach((btn, index) => {
        console.log(`Delete button ${index+1}: data-id=${btn.getAttribute('data-id')}`);
    });
    
    console.log("Assignments list updated successfully");
}

// Функция для обновления списка работ на проверке на странице преподавателя
function updateSubmissionsList(assignmentId = null) {
    console.log("%c UPDATING SUBMISSIONS LIST %c", 'background: purple; color: white; font-weight: bold;', '', 
        assignmentId ? `Filtering by assignment ID: ${assignmentId}` : "Showing all submissions");
    
    // Force reload submissions from localStorage to ensure we have the latest data
    try {
        const storedSubmissions = JSON.parse(localStorage.getItem('demoSubmissions') || '[]');
        if (storedSubmissions.length > 0) {
            submissions = storedSubmissions;
            console.log(`Successfully reloaded ${submissions.length} submissions from localStorage`);
        } else {
            console.warn("No submissions found in localStorage");
        }
    } catch (e) {
        console.error("Failed to reload submissions:", e);
    }
    
    // CRITICAL FIX: First ensure we have submissions data
    if (!submissions || submissions.length === 0) {
        console.warn("No submissions array or empty array");
        submissions = [];
    }
    
    // Find the submissions list container - TRY ALL POSSIBLE SELECTORS
    const possibleSelectors = ['.submissions-list', '.reviews-list', '.reviews-section .reviews-list', '.reviews-section'];
    let submissionsList = null;
    
    for (const selector of possibleSelectors) {
        const element = document.querySelector(selector);
        if (element) {
            // If we found a container, create or find a proper submissions list
            if (selector === '.reviews-section') {
                // Create a submissions list within the section if it doesn't exist
                let submissionsListInSection = element.querySelector('.reviews-list, .submissions-list');
                if (!submissionsListInSection) {
                    submissionsListInSection = document.createElement('div');
                    submissionsListInSection.className = 'reviews-list';
                    element.appendChild(submissionsListInSection);
                }
                submissionsList = submissionsListInSection;
            } else {
                submissionsList = element;
            }
            break;
        }
    }
    
    if (!submissionsList) {
        console.error("Submissions list container not found");
        alert("Error: Submissions list container not found on page.");
        return;
    }
    
    console.log(`Found submissions list container with className: ${submissionsList.className}`);
    console.log(`Current submissions in memory: ${submissions.length}`);
    
    // Очищаем текущий список
    submissionsList.innerHTML = '';
    
    // Добавляем стили для кнопок
    const styleElement = document.createElement('style');
    styleElement.textContent = `
        .btn-success {
            background-color: #28a745;
            color: white;
        }
        .btn-success:hover {
            background-color: #218838;
        }
        .loading-indicator {
            margin-left: 5px;
        }
        .reviewed-submission {
            border-left-color: #28a745 !important;
        }
        .view-report-btn {
            background-color: #e74c3c;
            color: white;
        }
        .view-report-btn:hover {
            background-color: #c0392b;
        }
        .submission-card {
            background-color: rgba(26, 26, 26, 0.9);
            border-radius: 8px;
            border-left: 4px solid #f39c12;
            padding: 15px;
            margin-bottom: 15px;
            transition: transform 0.3s ease;
        }
        .submission-card:hover {
            transform: translateX(5px);
        }
        .submission-header {
            display: flex;
            justify-content: space-between;
            margin-bottom: 10px;
        }
        .submission-title {
            font-weight: 600;
            color: #fff;
            font-size: 18px;
        }
        .submission-date {
            font-size: 12px;
            color: rgba(255, 255, 255, 0.6);
        }
        .submission-info {
            display: flex;
            justify-content: space-between;
            margin-bottom: 15px;
        }
        .student-info {
            display: flex;
            flex-direction: column;
            gap: 5px;
        }
        .student-name, .student-email {
            color: rgba(255, 255, 255, 0.8);
            font-size: 14px;
        }
        .submission-status {
            padding: 3px 8px;
            border-radius: 4px;
            font-size: 13px;
            background-color: rgba(243, 156, 18, 0.2);
        }
        .submission-status.reviewed {
            background-color: rgba(40, 167, 69, 0.2);
        }
        .submission-actions {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
        }
        .btn {
            padding: 7px 12px;
            border-radius: 4px;
            font-size: 13px;
            cursor: pointer;
            transition: all 0.2s ease;
            border: none;
        }
        .btn-outline {
            background-color: transparent;
            border: 1px solid rgba(255, 255, 255, 0.3);
            color: #fff;
        }
        .btn-primary {
            background-color: #f39c12;
            color: white;
        }
        .btn-primary:hover {
            background-color: #e67e22;
        }
    `;
    document.head.appendChild(styleElement);
    
    // Filter submissions by assignment if assignmentId is provided
    let filteredSubmissions = submissions || [];
    if (assignmentId !== null) {
        assignmentId = parseInt(assignmentId);
        filteredSubmissions = filteredSubmissions.filter(s => s && s.assignmentId === assignmentId);
        console.log(`Filtered to ${filteredSubmissions.length} submissions for assignment ${assignmentId}`);
        
        // Add a title to show which assignment's submissions are being displayed
        const assignment = assignments.find(a => a.id === assignmentId);
        if (assignment) {
            const filterTitle = document.createElement('div');
            filterTitle.className = 'filter-title';
            filterTitle.innerHTML = `
                <h3>Showing submissions for: ${assignment.title}</h3>
                <button class="btn btn-outline clear-filter-btn">
                    <i class="fas fa-times"></i> Clear Filter
                </button>
            `;
            submissionsList.appendChild(filterTitle);
            
            // Add event listener to the clear filter button
            const clearFilterBtn = filterTitle.querySelector('.clear-filter-btn');
            if (clearFilterBtn) {
                clearFilterBtn.addEventListener('click', function() {
                    updateSubmissionsList(); // Call without assignment ID to show all
                });
            }
        }
    }
    
    // Проверяем, есть ли отправки
    if (!filteredSubmissions || filteredSubmissions.length === 0) {
        submissionsList.innerHTML += `
            <div class="empty-state">
                <i class="fas fa-check-circle"></i>
                <p>${assignmentId ? 'No submissions for this assignment yet.' : 'No submissions yet. Students will submit their solutions here.'}</p>
            </div>
        `;
        console.log("No submissions to display, showing empty state");
        return;
    }
    
    console.log(`Displaying ${filteredSubmissions.length} submissions:`, filteredSubmissions);
    
    // Выводим отправки
    filteredSubmissions.forEach(submission => {
        // Skip invalid submissions
        if (!submission || typeof submission !== 'object') {
            console.warn("Skipping invalid submission:", submission);
            return;
        }
        
        const assignment = assignments.find(a => a.id === submission.assignmentId);
        const assignmentTitle = assignment ? assignment.title : 'Unknown Assignment';
        
        // Форматируем дату
        let dateStr = 'N/A';
        let statusClass = 'pending';
        let statusText = 'Pending Review';
        let reviewBtnText = 'Review';
        let reviewBtnClass = 'btn-primary review-btn';
        let reviewBtnIcon = 'fa-check-circle';
        let reviewBtnDisabled = '';
        
        if (submission.status === 'reviewed') {
            statusClass = 'reviewed';
            statusText = `Reviewed: ${submission.score}/10`;
            reviewBtnText = 'Reviewed';
            reviewBtnClass = 'btn-success review-btn';
            reviewBtnIcon = 'fa-check';
            reviewBtnDisabled = ''; // Still allow re-reviewing
        }
        
        try {
            if (submission.submittedAt) {
                const submittedDate = new Date(submission.submittedAt);
                if (!isNaN(submittedDate.getTime())) {
                    dateStr = submittedDate.toLocaleDateString('en-US', {
                        year: 'numeric', 
                        month: 'short', 
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit'
                    });
                }
            }
        } catch (e) {
            console.error("Error formatting submission date:", e);
        }
        
        // Создаем карточку отправки
        const submissionCard = document.createElement('div');
        submissionCard.className = `submission-card ${submission.status === 'reviewed' ? 'reviewed-submission' : ''}`;
        
        submissionCard.innerHTML = `
            <div class="submission-header">
                <h3 class="submission-title">${assignmentTitle}</h3>
                <span class="submission-date">Submitted: ${dateStr}</span>
            </div>
            
            <div class="submission-info">
                <div class="student-info">
                    <span class="student-name"><i class="fas fa-user"></i> ${submission.studentName || 'Unknown Student'}</span>
                    <span class="student-email"><i class="fas fa-envelope"></i> ${submission.studentEmail || 'No email'}</span>
                </div>
                
                <div class="submission-status ${statusClass}">
                    <i class="fas fa-${submission.status === 'reviewed' ? 'check-circle' : 'clock'}"></i> 
                    ${statusText}
                </div>
            </div>
            
            <div class="submission-actions">
                <button class="btn btn-outline view-btn" data-id="${submission.id}">
                    <i class="fas fa-eye"></i> View
                </button>
                
                <button class="btn ${reviewBtnClass}" data-id="${submission.id}" ${reviewBtnDisabled}>
                    <i class="fas ${reviewBtnIcon}"></i> ${reviewBtnText}
                </button>
                
                ${submission.status === 'reviewed' ? `
                <button class="btn view-report-btn" data-id="${submission.id}">
                    <i class="fas fa-file-alt"></i> View Report
                </button>
                ` : ''}
            </div>
        `;
        
        submissionsList.appendChild(submissionCard);
    });
    
    // Add event listener for the View Report button
    document.querySelectorAll('.view-report-btn').forEach(button => {
        button.addEventListener('click', function() {
            const submissionId = parseInt(this.getAttribute('data-id'));
            window.location.href = `analysis-report.html?id=${submissionId}`;
        });
    });
    
    console.log(`Displayed ${filteredSubmissions.length} submissions`);
    
    // Update review buttons event listeners
    document.querySelectorAll('.review-btn').forEach(button => {
        button.addEventListener('click', function() {
            const submissionId = parseInt(this.getAttribute('data-id'));
            console.log(`Review button clicked for submission ${submissionId}`);
            
            // Show loading indicator
            const loadingElement = document.createElement('span');
            loadingElement.className = 'loading-indicator';
            loadingElement.innerHTML = ' <i class="fas fa-spinner fa-spin"></i> Loading review...';
            this.appendChild(loadingElement);
            this.disabled = true;
            
            // Handle submission review
            analyzeSubmission(submissionId).then(analysis => {
                // Success - update will happen in the analyzeSubmission function
                console.log("Analysis complete:", analysis);
            }).catch(error => {
                console.error("Error analyzing submission:", error);
                // Remove loading indicator
                const loadingIndicator = this.querySelector('.loading-indicator');
                if (loadingIndicator) {
                    this.removeChild(loadingIndicator);
                }
                this.disabled = false;
                
                // Show error message
                alert("There was an error analyzing this submission. Please try again.");
            });
        });
    });
}

// Function to show the analysis report
function showAnalysisReport(submissionId) {
    console.log(`%c SHOWING ANALYSIS REPORT FOR SUBMISSION ${submissionId} %c`, 'background: blue; color: white; font-weight: bold;', '');
    
    // Get the submission
    const submission = submissions.find(s => s.id === submissionId);
    if (!submission) {
        console.error(`Submission ${submissionId} not found in ${submissions.length} submissions`);
        alert('Submission not found. Please try reloading the page.');
        return;
    }
    
    if (!submission.analysis && submission.status !== 'reviewed') {
        console.error(`Submission ${submissionId} has not been analyzed yet`);
        alert('This submission has not been analyzed yet. Please review it first.');
        return;
    }
    
    console.log('Showing analysis report for submission:', submission);
    
    // Store the submission ID in localStorage to retrieve it on the report page
    localStorage.setItem('currentAnalysisId', submissionId);
    
    // Check if we're on the analysis-report.html page already
    if (window.location.pathname.includes('analysis-report.html')) {
        console.log('Already on analysis report page, refreshing data...');
        // Refresh the report data if we're already on the page
        if (typeof loadAnalysisReport === 'function') {
            loadAnalysisReport(submissionId);
        }
    } else {
        // Redirect to the analysis report page
        console.log('Redirecting to analysis report page...');
        window.location.href = `analysis-report.html?id=${submissionId}`;
    }
}

// Функция для загрузки страницы отправки решения
function loadSubmissionPage() {
    console.log('Loading submission page...');
    
    // Загружаем сохраненные задания из localStorage
    const savedAssignments = localStorage.getItem('demoAssignments');
    if (savedAssignments) {
        assignments = JSON.parse(savedAssignments);
    } else {
        // Если нет сохраненных заданий, используем демо-данные
        assignments = getDemoAssignments();
        localStorage.setItem('demoAssignments', JSON.stringify(assignments));
    }
    
    // Получаем ID задания из URL
    const urlParams = new URLSearchParams(window.location.search);
    const assignmentId = parseInt(urlParams.get('id'));
    
    // Находим задание по ID
    const assignment = assignments.find(a => a.id === assignmentId);
    
    // Если задание не найдено, перенаправляем на панель управления
    if (!assignment) {
        alert('Assignment not found!');
        window.location.href = 'student-dashboard.html';
        return;
    }
    
    // Обновляем информацию о задании на странице
    updateAssignmentDetails(assignment);
    
    // Настраиваем форму отправки решения
    setupSubmissionForm(assignment);
    
    // Обработчики для пунктов меню
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        item.addEventListener('click', function() {
            const text = this.textContent.trim();
            
            if (text === 'Dashboard') {
                window.location.href = 'student-dashboard.html';
            } else if (text === 'Assignments') {
                window.location.href = 'student-dashboard.html#assignments';
            } else if (text === 'Submissions') {
                window.location.href = 'student-dashboard.html#submissions';
            } else if (text === 'Progress') {
                alert('Progress tracking will be available soon!');
            } else if (text === 'Grades') {
                alert('Detailed grades will be available soon!');
            } else if (text === 'Settings') {
                alert('Settings will be available soon!');
            } else if (text === 'Logout') {
                logout();
            }
        });
    });
}

// Функция для обновления деталей задания на странице отправки решения
function updateAssignmentDetails(assignment) {
    // Обновляем заголовок страницы
    const pageTitle = document.querySelector('.page-title');
    if (pageTitle) {
        pageTitle.textContent = `Submit Solution: ${assignment.title}`;
    }
    
    // Обновляем заголовок задания
    const assignmentTitle = document.querySelector('.assignment-title');
    if (assignmentTitle) {
        assignmentTitle.textContent = assignment.title;
    }
    
    // Обновляем дату дедлайна
    const dueDate = document.getElementById('dueDate');
    if (dueDate) {
        const formattedDate = new Date(assignment.dueDate).toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric' 
        });
        dueDate.textContent = `Due: ${formattedDate}`;
    }
    
    // Обновляем максимальные баллы
    const maxPoints = document.getElementById('maxPoints');
    if (maxPoints) {
        maxPoints.textContent = `Maximum Points: ${assignment.maxPoints}`;
    }
    
    // Обновляем описание задания
    const assignmentDescription = document.querySelector('.assignment-description');
    if (assignmentDescription) {
        assignmentDescription.textContent = assignment.description;
    }
}

// Функция для настройки формы отправки решения
function setupSubmissionForm(assignment) {
    // Получаем форму
    const submitBtn = document.getElementById('submitSolution');
    if (!submitBtn) return;
    
    // Получаем поле для загрузки файла
    const fileInput = document.getElementById('solutionFile');
    const selectedFile = document.getElementById('selectedFile');
    const fileName = document.getElementById('fileName');
    
    // Получаем текстовое поле для студенческого решения
    const studentSolutionTextarea = document.getElementById('studentSolution');
    
    // Обработчик изменения файла
    if (fileInput) {
        fileInput.addEventListener('change', function() {
            if (fileInput.files.length > 0) {
                fileName.textContent = fileInput.files[0].name;
                selectedFile.classList.add('active');
                submitBtn.disabled = false;
            } else {
                fileName.textContent = '';
                selectedFile.classList.remove('active');
                submitBtn.disabled = true;
            }
        });
    }
    
    // Обработчик удаления файла
    const removeFile = document.getElementById('removeFile');
    if (removeFile) {
        removeFile.addEventListener('click', function() {
            fileInput.value = '';
            fileName.textContent = '';
            selectedFile.classList.remove('active');
            submitBtn.disabled = true;
        });
    }
    
    // Обработчик отправки формы
    submitBtn.addEventListener('click', function() {
        console.log(`%c SUBMIT BUTTON CLICKED FOR ASSIGNMENT ${assignment.id} %c`, 'background: blue; color: white; font-weight: bold;', '');
        
        let studentSolution = {};
        
        // Проверяем наличие текстового поля для решения
        if (studentSolutionTextarea && studentSolutionTextarea.value) {
            studentSolution.solution = studentSolutionTextarea.value;
        }
        
        // Check if there's a file input with a file
        if (fileInput && fileInput.files.length) {
            studentSolution.file = fileInput.files[0].name;
        }
        
        // If we don't have either, show an error
        if (!studentSolution.solution && !studentSolution.file) {
            alert('Please enter your solution or upload a file!');
            return;
        }
        
        // Get any notes if they exist
        const notesField = document.getElementById('submissionNotes');
        if (notesField && notesField.value) {
            studentSolution.notes = notesField.value;
        }
        
        console.log("Preparing to submit solution:", studentSolution);
        
        // Показываем индикатор загрузки
        const loadingOverlay = document.getElementById('loadingOverlay');
        if (loadingOverlay) {
            loadingOverlay.classList.add('active');
        }
        
        // Имитируем отправку на сервер
        setTimeout(function() {
            // Submit the solution
            const submission = submitDemoSolution(assignment.id, studentSolution);
            console.log("Submission created:", submission);
            
            if (!submission) {
                console.error("Failed to create submission");
                alert("There was an error creating your submission. Please try again.");
                if (loadingOverlay) {
                    loadingOverlay.classList.remove('active');
                }
                return;
            }
            
            // Генерируем случайные метрики для демонстрации
            const correctness = Math.floor(Math.random() * 31 + 70); // 70-100%
            const completeness = Math.floor(Math.random() * 31 + 70); // 70-100%
            const efficiency = Math.floor(Math.random() * 31 + 70); // 70-100%
            const aiGrade = Math.floor(Math.random() * 3 + 7); // 7-10
            const aiConfidence = Math.floor(Math.random() * 16 + 85); // 85-100%
            
            // Генерируем случайный отзыв
            const feedbacks = [
                "Your solution is well-structured, but there are some mistakes in the matrix multiplication calculations. Review the dimensions of matrices before multiplying them.",
                "Good job on finding eigenvalues, but you need to double-check your eigenvector calculations. Make sure they satisfy the defining equation Av = λv.",
                "Your solution shows good understanding of linear transformations, but watch out for the kernel calculations. Remember that the kernel is the set of vectors that map to zero."
            ];
            const feedback = feedbacks[Math.floor(Math.random() * feedbacks.length)];
            
            // Обновляем решение с результатами анализа
            if (submission) {
                submission.analysis = {
                    correctness,
                    completeness,
                    efficiency
                };
                submission.aiGrade = aiGrade;
                submission.aiConfidence = aiConfidence;
                submission.feedback = feedback;
                
                // Сохраняем обновленное решение
                localStorage.setItem('demoSubmissions', JSON.stringify(submissions));
            }
            
            // Скрываем индикатор загрузки
            if (loadingOverlay) {
                loadingOverlay.classList.remove('active');
            }
            
            // Обновляем отображение метрик
            try {
                document.querySelector('.metric-correctness .metric-value').textContent = `${correctness}%`;
                document.querySelector('.metric-completeness .metric-value').textContent = `${completeness}%`;
                document.querySelector('.metric-efficiency .metric-value').textContent = `${efficiency}%`;
                document.querySelector('.metric-card.score .metric-value').textContent = aiGrade;
                document.querySelector('.ai-confidence').innerHTML = `<i class="fas fa-robot"></i><span>AI Confidence: ${aiConfidence}%</span>`;
                document.querySelector('.feedback-content').textContent = feedback;
                
                // Показываем результаты анализа
                document.querySelector('.submission-container').style.display = 'none';
                document.querySelector('.analysis-container').style.display = 'block';
            } catch (e) {
                console.error("Error updating UI with analysis results:", e);
                alert("Your solution has been submitted successfully!");
                window.location.href = 'student-dashboard.html';
            }
        }, 2000);
    });
    
    // Обработчики для кнопок действий после анализа
    const submitToTeacher = document.getElementById('submitToTeacher');
    if (submitToTeacher) {
        submitToTeacher.addEventListener('click', function() {
            alert('Your solution has been submitted to your teacher for review!');
            window.location.href = 'student-dashboard.html';
        });
    }
    
    const reviseSubmission = document.getElementById('reviseSubmission');
    if (reviseSubmission) {
        reviseSubmission.addEventListener('click', function() {
            document.querySelector('.submission-container').style.display = 'block';
            document.querySelector('.analysis-container').style.display = 'none';
        });
    }
}

// Вспомогательная функция для получения метки относительной даты
function getRelativeDateLabel(date) {
    const now = new Date();
    const diffDays = Math.floor((date - now) / (1000 * 60 * 60 * 24));
    
    if (diffDays < 0) {
        return 'Overdue';
    } else if (diffDays === 0) {
        return 'Due Today';
    } else if (diffDays === 1) {
        return 'Due Tomorrow';
    } else if (diffDays < 7) {
        return `Due in ${diffDays} days`;
    } else if (diffDays < 30) {
        const weeks = Math.floor(diffDays / 7);
        return `Due in ${weeks} week${weeks > 1 ? 's' : ''}`;
    } else {
        return 'Due in a month+';
    }
}

// Функция для обновления информации о пользователе в интерфейсе
function updateUserInfo() {
    console.log("Updating user info in UI for user:", currentUser);
    
    // Update user name in all possible locations
    const userNameElements = document.querySelectorAll('.user-name, #userName, #welcomeName');
    userNameElements.forEach(element => {
        if (element) {
            element.textContent = currentUser.name || 'User';
            console.log(`Updated user name element to: ${currentUser.name}`);
        }
    });
    
    // Update welcome message if it exists
    const welcomeMessage = document.querySelector('.welcome-message');
    if (welcomeMessage) {
        const welcomeNameSpan = welcomeMessage.querySelector('#welcomeName');
        if (welcomeNameSpan) {
            welcomeNameSpan.textContent = currentUser.name || 'User';
        } else {
            welcomeMessage.innerHTML = welcomeMessage.innerHTML.replace('Welcome back, Student', `Welcome back, ${currentUser.name}`);
        }
    }
    
    // Update user role if it exists
    const userRoleElements = document.querySelectorAll('.user-role');
    userRoleElements.forEach(element => {
        if (element) {
            element.textContent = currentUser.role === 'teacher' ? 'Teacher' : 'Student';
        }
    });
    
    console.log("User info updated in UI");
}

// Функция для имитации входа в систему
function login(email, password, role) {
    console.log(`Logging in with email: ${email}, role: ${role}`);
    
    // В демо-версии просто устанавливаем флаг авторизации
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('userEmail', email);
    localStorage.setItem('userRole', role);
    
    // Устанавливаем имя пользователя по email или генерируем
    let name = '';
    
    if (email) {
        // Try to create a name from the email
        const nameFromEmail = email.split('@')[0];
        // Capitalize the first letter and replace dots/numbers with spaces
        name = nameFromEmail
            .charAt(0).toUpperCase() + 
            nameFromEmail.slice(1)
            .replace(/\./g, ' ')
            .replace(/[0-9]/g, '');
    } else {
        name = role === 'teacher' ? 'Teacher Account' : 'Student User';
    }
    
    localStorage.setItem('userName', name);
    
    // Обновляем глобальные переменные
    isLoggedIn = true;
    currentUser = {
        name: name,
        email: email,
        role: role
    };
    
    console.log(`User logged in successfully: ${name} (${role})`);
    
    // CRITICAL FIX: Ensure demo data exists before redirecting
    // This fixes issues where a new user wouldn't have any data
    if (role === 'teacher') {
        console.log("Pre-loading data for teacher...");
        ensureTestDataExists();
    }
    
    // Перенаправляем на соответствующую панель управления
    isRedirecting = true;
    if (role === 'teacher') {
        window.location.href = 'teacher-dashboard.html';
    } else {
        window.location.href = 'student-dashboard.html';
    }
}

// Функция для регистрации пользователя
function register(name, email, password, role) {
    console.log(`Registering as ${role}...`);
    
    // Устанавливаем флаг перенаправления
    isRedirecting = true;
    
    // В демо-режиме просто имитируем успешную регистрацию
    localStorage.setItem('isLoggedIn', 'true');
    localStorage.setItem('userName', name);
    localStorage.setItem('userEmail', email);
    localStorage.setItem('userRole', role);
    
    isLoggedIn = true;
    currentUser = { name, email, role };
    
    // Перенаправляем пользователя на соответствующую страницу
    console.log(`Redirecting to ${role} dashboard...`);
    if (role === 'student') {
        window.location.href = 'student-dashboard.html';
    } else {
        window.location.href = 'teacher-dashboard.html';
    }
    
    return true;
}

// Функция для выхода пользователя из аккаунта
function logout() {
    console.log("Logging out user...");
    
    // Очищаем параметры авторизации в localStorage
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('userName');
    localStorage.removeItem('userRole');
    
    // Do not clear assignments and submissions as they need to persist between sessions
    
    // Сбрасываем глобальные переменные
    isLoggedIn = false;
    currentUser = null;
    isRedirecting = true;
    
    // Перенаправляем на страницу входа
    console.log("Redirecting to login page...");
    window.location.href = 'index.html';
}

// Функция для анимации перехода между страницами
function animatePageTransition(callback) {
    const transitionOverlay = document.createElement('div');
    transitionOverlay.className = 'page-transition-overlay';
    document.body.appendChild(transitionOverlay);
    
    // Анимируем появление оверлея
    setTimeout(() => {
        transitionOverlay.style.opacity = '1';
        
        // Когда анимация завершена, выполняем колбэк (например, переход на другую страницу)
        setTimeout(() => {
            if (callback) callback();
            
            // Анимируем скрытие оверлея после перехода
            setTimeout(() => {
                transitionOverlay.style.opacity = '0';
                setTimeout(() => {
                    document.body.removeChild(transitionOverlay);
                }, 500);
            }, 100);
        }, 500);
    }, 10);
}

// Имитация запроса к API для загрузки данных (в демо-режиме возвращаем фиктивные данные)
function fetchData(endpoint, options = {}) {
    return new Promise((resolve, reject) => {
        // Имитируем задержку сетевого запроса
        setTimeout(() => {
            switch (endpoint) {
                case 'assignments':
                    resolve(getDemoAssignments());
                    break;
                case 'submissions':
                    resolve(getDemoSubmissions());
                    break;
                case 'ai-analyze':
                    resolve(getDemoAIAnalysis(options.assignmentId, options.submissionContent));
                    break;
                default:
                    reject(new Error('Unknown endpoint'));
            }
        }, 500 + Math.random() * 1000); // Случайная задержка от 500 до 1500 мс
    });
}

// Function to get demo assignments data
function getDemoAssignments() {
    console.log("Generating demo assignments data");
    
    // Create sample assignments
    return [
        {
            id: 1,
            title: "Matrix Operations",
            description: "Implement basic matrix operations like addition, subtraction, multiplication, and finding determinants.",
            dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(), // 1 week from now
            perfectSolution: "matrix_ops_solution.ipynb",
            createdAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days ago
            createdBy: "teacher@example.com",
            maxPoints: 10,
            submissionsCount: 3,
            reviewedCount: 2
        },
        {
            id: 2,
            title: "Eigenvalues and Eigenvectors",
            description: "Calculate eigenvalues and eigenvectors for given matrices and explore their properties.",
            dueDate: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString(), // 2 weeks from now
            perfectSolution: "eigen_solution.ipynb",
            createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
            createdBy: "teacher@example.com",
            maxPoints: 10,
            submissionsCount: 1,
            reviewedCount: 0
        },
        {
            id: 3,
            title: "Linear Systems Solver",
            description: "Implement methods to solve systems of linear equations using Gaussian elimination.",
            dueDate: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(), // 10 days from now
            perfectSolution: "linear_systems_solution.ipynb",
            createdAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
            createdBy: "teacher@example.com",
            maxPoints: 10,
            submissionsCount: 2,
            reviewedCount: 1
        },
        {
            id: 4,
            title: "Vector Spaces",
            description: "Explore properties of vector spaces and subspaces, including basis and dimension.",
            dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000).toISOString(), // 5 days from now
            perfectSolution: "vector_spaces_solution.ipynb",
            createdAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
            createdBy: "teacher@example.com",
            maxPoints: 10,
            submissionsCount: 0,
            reviewedCount: 0
        },
        {
            id: 5,
            title: "Orthogonality and Projections",
            description: "Implement algorithms for finding orthogonal basis and projections onto subspaces.",
            dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days from now
            perfectSolution: "orthogonality_solution.ipynb",
            createdAt: new Date(Date.now() - 4 * 24 * 60 * 60 * 1000).toISOString(), // 4 days ago
            createdBy: "teacher@example.com",
            maxPoints: 10,
            submissionsCount: 1,
            reviewedCount: 1
        }
    ];
}

// Function to get demo submissions data
function getDemoSubmissions() {
    console.log("Generating demo submissions data");
    
    // Create sample submissions with varied status
    return [
            {
                id: 1,
                assignmentId: 1,
            studentId: 101,
            studentEmail: "alice@student.edu",
            studentName: "Alice Smith",
            submittedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(), // 3 days ago
            solution: "Alice's solution content",
            solutionFile: "alice_matrix_ops.ipynb",
            notes: "Completed all exercises with minor issues",
            status: "reviewed",
            score: 8.5,
            aiConfidence: 0.92,
            feedback: "Good work overall, but some edge cases weren't handled properly.",
            reviewedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
            analysis: getDemoAIAnalysis(1, { studentName: "Alice Smith" })
            },
            {
                id: 2,
            assignmentId: 1,
            studentId: 102,
            studentEmail: "bob@student.edu",
            studentName: "Bob Johnson",
            submittedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
            solution: "Bob's solution content",
            solutionFile: "bob_matrix_ops.ipynb",
            notes: "Implemented all required functions",
            status: "reviewed",
            score: 7.2,
            aiConfidence: 0.88,
            feedback: "Good implementation but needs improvement in matrix multiplication algorithm.",
            reviewedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
            analysis: getDemoAIAnalysis(1, { studentName: "Bob Johnson" })
            },
            {
                id: 3,
                assignmentId: 1,
            studentId: 103,
            studentEmail: "carol@student.edu",
            studentName: "Carol Martinez",
            submittedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
            solution: "Carol's solution content",
            solutionFile: "carol_matrix_ops.ipynb",
            notes: "Complete solution, needs review",
            status: "pending",
            score: null,
            aiConfidence: null,
            feedback: null
            },
            {
                id: 4,
            assignmentId: 2,
            studentId: 101,
            studentEmail: "alice@student.edu",
            studentName: "Alice Smith",
            submittedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
            solution: "Alice's eigenvalues solution",
            solutionFile: "alice_eigen.ipynb",
            notes: "Implemented all required functions for eigenvalues",
            status: "pending",
            score: null,
            aiConfidence: null,
            feedback: null
            },
            {
                id: 5,
            assignmentId: 3,
            studentId: 102,
            studentEmail: "bob@student.edu",
            studentName: "Bob Johnson",
            submittedAt: new Date(Date.now() - 1.5 * 24 * 60 * 60 * 1000).toISOString(), // 1.5 days ago
            solution: "Bob's linear systems solution",
            solutionFile: "bob_linear_systems.ipynb",
            notes: "Implemented Gaussian elimination algorithms",
            status: "reviewed",
            score: 9.1,
            aiConfidence: 0.95,
            feedback: "Excellent implementation with good optimization.",
            reviewedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
            analysis: getDemoAIAnalysis(3, { studentName: "Bob Johnson" })
        },
        {
            id: 6,
            assignmentId: 3,
            studentId: 104,
            studentEmail: "david@student.edu",
            studentName: "David Wilson",
            submittedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
            solution: "David's linear systems solution",
            solutionFile: "david_linear_systems.ipynb",
            notes: "First attempt, may need help with some sections",
            status: "pending",
                score: null,
            aiConfidence: null,
                feedback: null
        },
        {
            id: 7,
            assignmentId: 5,
            studentId: 105,
            studentEmail: "emma@student.edu",
            studentName: "Emma Rodriguez",
            submittedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days ago
            solution: "Emma's orthogonality solution",
            solutionFile: "emma_orthogonality.ipynb",
            notes: "Implemented algorithms for orthogonal projections",
            status: "reviewed",
            score: 9.8,
            aiConfidence: 0.98,
            feedback: "Outstanding work with excellent documentation and optimization.",
            reviewedAt: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(), // 1 day ago
            analysis: getDemoAIAnalysis(5, { studentName: "Emma Rodriguez" })
        }
    ];
}

// Function to generate AI analysis for a student submission
function getDemoAIAnalysis(assignmentId, submission) {
    console.log("Generating analysis for submission:", submission);
    console.log("Looking for assignment with ID:", assignmentId);
    
    // Find the associated assignment
    const assignment = assignments.find(a => a.id === assignmentId);
    if (!assignment) {
        console.error(`Cannot generate analysis: Assignment with ID ${assignmentId} not found`);
    return {
            error_summary: "Ошибка: Не удалось найти связанное задание для этой работы.",
            detailed_feedback: { 
                weaknesses: ["Системная ошибка: Задание не найдено"] 
            },
            confidence_score: 0,
            grade: 0,
            cell_annotations: []
        };
    }
    
    // In a real system, this would compare the actual notebook files
    // For demo purposes, we'll simulate a more realistic analysis by checking keywords
    
    let score = 0;
    let confidenceScore = 0.85;
    let errorSummary = "";
    let strengths = [];
    let weaknesses = [];
    let suggestions = [];
    
    // Check if the submission mentions error checking
    // In a real system, we'd parse the actual notebook files
    const solutionText = (typeof submission.solution === 'string') ? 
        submission.solution.toLowerCase() : 
        JSON.stringify(submission.solution).toLowerCase();
    
    // Perfect solution has these key features that we'll check for
    const errorFeatures = {
        dimensionCheck: {
            found: solutionText.includes("dimension") && solutionText.includes("check"),
            description: "Проверка размерности матриц"
        },
        squareMatrixCheck: {
            found: solutionText.includes("square") && solutionText.includes("matrix"),
            description: "Проверка квадратности матрицы для определителя и обратной матрицы"
        },
        singularityCheck: {
            found: solutionText.includes("singular") || (solutionText.includes("det") && solutionText.includes("zero")),
            description: "Проверка сингулярности для обратной матрицы"
        },
        properErrorHandling: {
            found: solutionText.includes("error") && solutionText.includes("return") && solutionText.includes("none"),
            description: "Корректная обработка ошибок с возвратом None"
        },
        vectorizedOperations: {
            found: solutionText.includes("np.dot") || solutionText.includes("np.linalg"),
            description: "Эффективные векторизованные операции"
        }
    };
    
    // Count features found
    let foundFeatures = 0;
    let totalFeatures = Object.keys(errorFeatures).length;
    
    // Analyze each feature and build feedback
    for (const [key, feature] of Object.entries(errorFeatures)) {
        if (feature.found) {
            foundFeatures++;
            strengths.push(`Корректно реализована ${feature.description}`);
        } else {
            weaknesses.push(`Отсутствует или некорректная ${feature.description}`);
            suggestions.push(`Добавьте корректную ${feature.description} перед выполнением операций`);
        }
    }
    
    // Calculate score based on features found
    score = Math.round((foundFeatures / totalFeatures) * 10);
    
    // Check if the student solution is very similar to the perfect solution
    if (foundFeatures === totalFeatures) {
        confidenceScore = 0.98;
        errorSummary = "Решение корректно реализует все необходимые операции с матрицами с правильной валидацией.";
    } else if (foundFeatures >= 3) {
        errorSummary = "Решение реализует большинство операций с матрицами правильно, но отсутствуют некоторые важные проверки.";
    } else if (foundFeatures >= 1) {
        errorSummary = "Решение имеет значительные проблемы с валидацией и обработкой ошибок для операций с матрицами.";
    } else {
        errorSummary = "В решении отсутствуют критически важные проверки и обработка ошибок для операций с матрицами.";
        confidenceScore = 0.90; // Higher confidence for clearly incorrect solutions
    }
    
    // Create cell annotations
    const cellAnnotations = [];
    
    // Add specific annotations based on the analysis
    if (!errorFeatures.dimensionCheck.found) {
        cellAnnotations.push({
            cell_index: 2,
            comments: ["Отсутствует валидация размерности для сложения матриц"]
        });
        cellAnnotations.push({
            cell_index: 3,
            comments: ["Некорректная проверка размерности для умножения матриц"]
        });
    }
    
    if (!errorFeatures.squareMatrixCheck.found) {
        cellAnnotations.push({
            cell_index: 4,
            comments: ["Отсутствует проверка, что матрица квадратная перед вычислением определителя"]
        });
    }
    
    if (!errorFeatures.singularityCheck.found) {
        cellAnnotations.push({
            cell_index: 5,
            comments: ["Отсутствует проверка на сингулярность матрицы перед вычислением обратной матрицы"]
        });
    }
    
    return {
        error_summary: errorSummary,
        detailed_feedback: {
            strengths: strengths,
            weaknesses: weaknesses,
            suggestions: suggestions
        },
        confidence_score: confidenceScore,
        grade: score,
        cell_annotations: cellAnnotations
    };
}

// Генерация фиктивного отзыва AI
function generateAIFeedback(score) {
    if (score >= 9) {
        return "Excellent work! The solution correctly implements all required operations and demonstrates a solid understanding of linear algebra concepts. The code is well-structured and efficient.";
    } else if (score >= 7) {
        return "Good job! The solution correctly implements most operations with minor issues. The approach shows understanding of linear algebra concepts but could be optimized in some places.";
    } else if (score >= 5) {
        return "Satisfactory solution with some issues. The implementation works for basic cases but doesn't handle all edge cases correctly. Some improvements are needed in understanding of matrix operations.";
    } else {
        return "The solution needs significant improvements. There are fundamental issues with the implementation of matrix operations. Please review the concepts and try again.";
    }
}

// Функция для создания нового задания (для демо)
function createDemoAssignment(title, description, dueDate, perfectSolution) {
    console.log(`Creating demo assignment: ${title}`);
    
    // Generate unique ID for the assignment
    const lastAssignment = assignments.length > 0 ? assignments[assignments.length - 1] : { id: 0 };
    const newId = lastAssignment.id + 1;
    
    // Create assignment object
    const assignment = {
        id: newId,
        title: title,
        description: description,
        dueDate: dueDate,
        perfectSolution: perfectSolution,
        createdAt: new Date().toISOString(),
        createdBy: currentUser.email || 'demo@proofmate.edu',
        maxPoints: 10,
        submissionsCount: 0,
        reviewedCount: 0
    };
    
    // Добавляем задание в массив и сохраняем в localStorage
    assignments.push(assignment);
    localStorage.setItem('demoAssignments', JSON.stringify(assignments));
    
    console.log(`Demo assignment created with ID: ${newId}`);
    
    // Update dashboard stats after creating a new assignment
    updateTeacherDashboardStats();
    
    return assignment;
}

// Функция для отправки решения (для демонстрационных целей)
function submitDemoSolution(assignmentId, studentSolution) {
    console.log(`%c SUBMITTING SOLUTION FOR ASSIGNMENT ${assignmentId} %c`, 'background: blue; color: white; font-weight: bold;', '');
    
    // Make sure assignments is loaded and an array
    if (!Array.isArray(assignments) || assignments.length === 0) {
        console.error("No assignments available. Attempting to reload from localStorage");
        const savedAssignments = localStorage.getItem('demoAssignments');
        if (savedAssignments) {
            try {
                assignments = JSON.parse(savedAssignments);
                console.log(`Loaded ${assignments.length} assignments from localStorage`);
            } catch (e) {
                console.error("Failed to parse assignments from localStorage:", e);
                alert("Error: Could not load assignments. Please refresh the page and try again.");
                return null;
            }
        } else {
            console.error("No assignments found in localStorage");
            alert("Error: No assignments available. Please refresh the page and try again.");
            return null;
        }
    }
    
    // Load all current submissions first
    try {
        const savedSubmissions = localStorage.getItem('demoSubmissions');
        if (savedSubmissions) {
            submissions = JSON.parse(savedSubmissions);
            console.log(`Loaded ${submissions.length} submissions before adding new one`);
        }
    } catch (e) {
        console.error("Error loading existing submissions:", e);
        submissions = []; // Reset to empty array if there's an error
    }
    
    // Handle both string and number IDs by converting both to strings for comparison
    assignmentId = parseInt(assignmentId);
    const assignment = assignments.find(a => a.id === assignmentId);
    
    console.log("All assignments:", assignments);
    
    if (!assignment) {
        console.error(`Assignment with ID ${assignmentId} not found in:`, assignments);
        alert(`Error: Assignment not found. Please refresh the page and try again.`);
        return null;
    }
    
    console.log(`Found assignment for submission: ${assignment.title} (ID: ${assignment.id})`);
    
    // Generate new submission ID - make sure it's unique
    const submissionId = submissions.length > 0 ? 
        Math.max(...submissions.map(s => s.id)) + 1 : 
        1;
    
    // Handle file object if present
    let fileContent = null;
    let fileName = "student_solution.ipynb";
    
    // If studentSolution is a File object (comes from input[type=file])
    if (studentSolution instanceof File) {
        console.log("Processing direct File object submission");
        fileName = studentSolution.name;
        
        // We'll create a promise to read the file content
        const fileReadPromise = new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = function(e) {
                fileContent = e.target.result;
                console.log(`Read file content (${fileContent.length} bytes)`);
                resolve(fileContent);
            }
            reader.readAsText(studentSolution);
        });
        
        // Wait for file to be read
        fileReadPromise.then(() => {
            finalizeSubmission();
        });
        
        return; // Early return, finalizeSubmission will handle the submission creation
    } 
    // If studentSolution contains a 'file' property that is a File object
    else if (studentSolution.file instanceof File) {
        console.log("Processing File object from solution.file");
        fileName = studentSolution.file.name;
        
        // Create a promise to read the file content
        const fileReadPromise = new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = function(e) {
                fileContent = e.target.result;
                console.log(`Read file content (${fileContent.length} bytes)`);
                resolve(fileContent);
            }
            reader.readAsText(studentSolution.file);
        });
        
        // Wait for file to be read
        fileReadPromise.then(() => {
            finalizeSubmission();
        });
        
        return; // Early return, finalizeSubmission will handle the submission creation
    }
    
    // If no async file reading is needed, proceed with submission
    finalizeSubmission();
    
    // Function to create and save the submission once the file is read
    function finalizeSubmission() {
    // Create new submission object
    const newSubmission = {
        id: submissionId,
        assignmentId: assignmentId,
        studentId: currentUser?.id || 101,
        studentEmail: currentUser?.email || 'student@example.com',
        studentName: currentUser?.name || 'Test Student',
        submittedAt: new Date().toISOString(),
            solution: fileContent || (typeof studentSolution === 'string' ? 
                studentSolution : JSON.stringify(studentSolution)),
            solutionFile: fileName,
        notes: typeof studentSolution === 'object' ? studentSolution.notes || '' : 'Submitted from student dashboard',
        status: 'pending',
        score: null,
        aiConfidence: null,
        feedback: null
    };
    
    console.log("Created new submission:", newSubmission);
    
    // Add submission to the array
    submissions.push(newSubmission);
    
    // Update assignment submission count
    assignment.submissionsCount = (assignment.submissionsCount || 0) + 1;
    
    // Save both submissions and assignments back to localStorage
    try {
        localStorage.setItem('demoSubmissions', JSON.stringify(submissions));
        localStorage.setItem('demoAssignments', JSON.stringify(assignments));
        console.log(`Saved ${submissions.length} submissions to localStorage`);
        console.log(`Updated assignment ${assignmentId} submission count to ${assignment.submissionsCount}`);
    } catch (e) {
        console.error("Error saving to localStorage:", e);
        alert("Error: Could not save your submission. Please try again.");
        return null;
    }
        
        // Notify user of success
        try {
            alert("Solution submitted successfully!");
        } catch (e) {
            console.error("Error showing alert:", e);
    }
    
    // Force reload data in parent window if opened from iframe or popup
    try {
        if (window.opener && !window.opener.closed) {
            console.log("Notifying parent window about new submission");
            window.opener.submissions = submissions;
            window.opener.assignments = assignments;
            
                // Try to call parent's updateStudentDashboardStats directly if it exists
                if (typeof window.opener.updateStudentDashboardStats === 'function') {
                    const studentEmail = currentUser?.email || 'student@example.com';
                    const studentSubmissions = submissions.filter(sub => sub.studentEmail === studentEmail);
                    const submittedAssignmentIds = studentSubmissions.map(sub => sub.assignmentId);
                    const availableAssignments = assignments.filter(assignment => !submittedAssignmentIds.includes(assignment.id));
                    window.opener.updateStudentDashboardStats(studentSubmissions, availableAssignments);
                }
                
                // Also try other parent update functions
            if (typeof window.opener.updateSubmissionsList === 'function') {
                window.opener.updateSubmissionsList();
            }
                
                if (typeof window.opener.updateStudentAssignmentsList === 'function' && 
                    typeof window.opener.updateStudentSubmissionsList === 'function') {
                    const studentEmail = currentUser?.email || 'student@example.com';
                    const studentSubmissions = submissions.filter(sub => sub.studentEmail === studentEmail);
                    const submittedAssignmentIds = studentSubmissions.map(sub => sub.assignmentId);
                    const availableAssignments = assignments.filter(assignment => !submittedAssignmentIds.includes(assignment.id));
                    
                    window.opener.updateStudentAssignmentsList(availableAssignments);
                    window.opener.updateStudentSubmissionsList(studentSubmissions);
            }
            
            // Try to call parent's forceRefreshData if it exists
            if (typeof window.opener.forceRefreshData === 'function') {
                window.opener.forceRefreshData();
            }
        }
    } catch (e) {
        console.error("Error communicating with parent window:", e);
    }
        
        // Update dashboard stats if we're on the student dashboard
        if (window.location.pathname.includes('student-dashboard')) {
            // Filter the student submissions for the current user
            if (currentUser && currentUser.email) {
                const studentEmail = currentUser.email;
                const studentSubmissions = submissions.filter(sub => sub.studentEmail === studentEmail);
                const submittedAssignmentIds = studentSubmissions.map(sub => sub.assignmentId);
                const availableAssignments = assignments.filter(assignment => !submittedAssignmentIds.includes(assignment.id));
                
                // Update the dashboard stats
                updateStudentDashboardStats(studentSubmissions, availableAssignments);
                // Also update the assignments and submissions lists
                updateStudentAssignmentsList(availableAssignments);
                updateStudentSubmissionsList(studentSubmissions);
            }
    }
    
    console.log(`%c Submission created successfully with ID: ${newSubmission.id} %c`, 'background: green; color: white; font-weight: bold;', '');
    
    return newSubmission;
    }
}

// Функция для создания новой отправки задания (для демо)
function createDemoSubmission(assignmentId, studentId, studentName, solutionFile, notes) {
    console.log(`Creating new submission for assignment ${assignmentId} by student ${studentId}`);
    
    const newSubmission = {
        id: submissions.length + 1,
        assignmentId: assignmentId,
        studentId: studentId,
        studentName: studentName,
        submittedAt: new Date().toISOString(),
        solutionFile: solutionFile,
        notes: notes || '',
        status: 'pending',
        score: null,
        aiConfidence: null,
        feedback: null
    };
    
    submissions.push(newSubmission);
    
    // Обновляем счетчик отправок у задания
    const assignment = assignments.find(a => a.id === assignmentId);
    if (assignment) {
        assignment.submissionsCount = (assignment.submissionsCount || 0) + 1;
    }
    
    // Сохраняем обновленные данные в localStorage
    localStorage.setItem('demoSubmissions', JSON.stringify(submissions));
    localStorage.setItem('demoAssignments', JSON.stringify(assignments));
    
    console.log(`Submission created with ID: ${newSubmission.id}`);
    return newSubmission;
}

// Функция для генерации оценки и отзыва AI (для демонстрационных целей)
function generateDemoAIReview(submissionId, reviewButton) {
    console.log(`Generating AI review for submission ${submissionId}`);
    
    // Находим отправку
    const submission = submissions.find(s => s.id === submissionId);
    if (!submission) {
        console.error(`Submission with ID ${submissionId} not found`);
        if (reviewButton) {
            reviewButton.disabled = false;
            const loadingIndicator = reviewButton.querySelector('.loading-indicator');
            if (loadingIndicator) {
                reviewButton.removeChild(loadingIndicator);
            }
        }
        return null;
    }
    
    // Находим задание
    const assignment = assignments.find(a => a.id === submission.assignmentId);
    if (!assignment) {
        console.error(`Assignment with ID ${submission.assignmentId} not found`);
        if (reviewButton) {
            reviewButton.disabled = false;
            const loadingIndicator = reviewButton.querySelector('.loading-indicator');
            if (loadingIndicator) {
                reviewButton.removeChild(loadingIndicator);
            }
        }
        return null;
    }
    
    // Создаем и показываем интерфейс верификации
    const verificationOverlay = document.createElement('div');
    verificationOverlay.className = 'verification-overlay';
    verificationOverlay.innerHTML = `
        <div class="verification-container">
            <div class="verification-spinner"></div>
            <p class="verification-message">Work verification is in progress</p>
        </div>
    `;
    
    // Добавляем стили для интерфейса верификации
    const styleElement = document.createElement('style');
    styleElement.textContent = `
        .verification-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: rgba(0, 0, 0, 0.7);
            display: flex;
            justify-content: center;
            align-items: center;
            z-index: 9999;
        }
        .verification-container {
            background-color: #121212;
            padding: 30px;
            border-radius: 10px;
            box-shadow: 0 0 20px rgba(0, 0, 0, 0.3);
            text-align: center;
            max-width: 400px;
        }
        .verification-spinner {
            width: 60px;
            height: 60px;
            margin: 0 auto 20px;
            border: 5px solid rgba(255, 255, 255, 0.1);
            border-radius: 50%;
            border-top-color: #ff6b6b;
            animation: spin 1s ease-in-out infinite;
        }
        .verification-message {
            color: #ffffff;
            font-size: 18px;
            margin: 0;
            font-weight: 500;
        }
        @keyframes spin {
            to { transform: rotate(360deg); }
        }
    `;
    
    document.head.appendChild(styleElement);
    document.body.appendChild(verificationOverlay);
    
    // Чтение отзыва из файла review.txt
    fetch('review.txt')
        .then(response => {
            // Проверяем, успешен ли запрос
            if (!response.ok) {
                throw new Error(`Failed to load review.txt: ${response.status} ${response.statusText}`);
            }
            return response.text();
        })
        .then(reviewText => {
            console.log("Loaded review from file:", reviewText);
            
            // Извлекаем оценку из текста отзыва
            let score = 8; // Значение по умолчанию
            const scoreMatch = reviewText.match(/Overall score:\s*(\d+(\.\d+)?)\s*\/\s*10/i);
            if (scoreMatch && scoreMatch[1]) {
                score = parseFloat(scoreMatch[1]);
                console.log(`Extracted score from review text: ${score}`);
            }
            
            // Генерируем случайную уверенность AI от 85% до 98%
            const aiConfidence = Math.floor(Math.random() * 14) + 85;
            
            // Обновляем отправку
            submission.status = 'reviewed';
            submission.score = score;
            submission.aiConfidence = aiConfidence;
            submission.feedback = reviewText;
            submission.reviewedAt = new Date().toISOString();
            
            // Обновляем счетчик проверенных отправок у задания
            assignment.reviewedCount = (assignment.reviewedCount || 0) + 1;
            
            // Сохраняем обновленные данные в localStorage
            localStorage.setItem('demoSubmissions', JSON.stringify(submissions));
            localStorage.setItem('demoAssignments', JSON.stringify(assignments));
            
            console.log(`Review generated for submission ${submissionId}: Score ${score}, Confidence ${aiConfidence}%`);
            
            // Отложенное скачивание файла после 8 секунд
            setTimeout(() => {
                // Удаляем интерфейс верификации
                document.body.removeChild(verificationOverlay);
                
                // Создаем и автоматически скачиваем файл review.txt
                const blob = new Blob([reviewText], { type: 'text/plain' });
                const url = window.URL.createObjectURL(blob);
                const downloadLink = document.createElement('a');
                downloadLink.href = url;
                downloadLink.download = `review_submission_${submissionId}.txt`;
                
                // Добавляем элемент в DOM, симулируем клик и удаляем его
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
                
                // Очищаем URL объект
                setTimeout(() => {
                    window.URL.revokeObjectURL(url);
                }, 100);
                
                // Обновляем отображение
                updateSubmissionsList();
                
                // Возвращаем кнопку в исходное состояние
                if (reviewButton) {
                    reviewButton.disabled = false;
                    const loadingIndicator = reviewButton.querySelector('.loading-indicator');
                    if (loadingIndicator) {
                        reviewButton.removeChild(loadingIndicator);
                    }
                    reviewButton.innerHTML = 'Reviewed <i class="fas fa-check"></i>';
                    reviewButton.classList.remove('btn-primary');
                    reviewButton.classList.add('btn-success');
                }
            }, 8000); // 8 секунд ожидания
            
            return submission;
        })
        .catch(error => {
            console.error("Error loading review file:", error);
            
            // Fallback to random review generation if file loading fails
            const score = Math.floor(Math.random() * 5) + 6;
            const aiConfidence = Math.floor(Math.random() * 24) + 75;
            
            const feedbackOptions = [
                `Good work! Your solution is mostly correct with minor issues. Score: ${score}/10`,
                `Excellent understanding of the concepts. Keep up the good work! Score: ${score}/10`,
                `Your solution demonstrates a solid grasp of the material. Some optimizations could be made. Score: ${score}/10`,
                `Well done! Your approach is correct, but there are some inefficiencies in your implementation. Score: ${score}/10`,
                `Great job! Your solution is well-structured and efficient. Score: ${score}/10`
            ];
            
            const feedback = feedbackOptions[Math.floor(Math.random() * feedbackOptions.length)];
            
            // Обновляем отправку
            submission.status = 'reviewed';
            submission.score = score;
            submission.aiConfidence = aiConfidence;
            submission.feedback = feedback;
            submission.reviewedAt = new Date().toISOString();
            
            // Обновляем счетчик проверенных отправок у задания
            assignment.reviewedCount = (assignment.reviewedCount || 0) + 1;
            
            // Сохраняем обновленные данные в localStorage
            localStorage.setItem('demoSubmissions', JSON.stringify(submissions));
            localStorage.setItem('demoAssignments', JSON.stringify(assignments));
            
            console.log(`Failed to load review from file. Generated random review for submission ${submissionId}: Score ${score}, Confidence ${aiConfidence}%`);
            
            // Отложенное скачивание файла после 8 секунд
            setTimeout(() => {
                // Удаляем интерфейс верификации
                document.body.removeChild(verificationOverlay);
                
                // Также создаем и скачиваем файл с сгенерированным отзывом
                const blob = new Blob([feedback], { type: 'text/plain' });
                const url = window.URL.createObjectURL(blob);
                const downloadLink = document.createElement('a');
                downloadLink.href = url;
                downloadLink.download = `review_submission_${submissionId}.txt`;
                
                // Добавляем элемент в DOM, симулируем клик и удаляем его
                document.body.appendChild(downloadLink);
                downloadLink.click();
                document.body.removeChild(downloadLink);
                
                // Очищаем URL объект
                setTimeout(() => {
                    window.URL.revokeObjectURL(url);
                }, 100);
                
                // Обновляем отображение
                updateSubmissionsList();
                
                // Возвращаем кнопку в исходное состояние
                if (reviewButton) {
                    reviewButton.disabled = false;
                    const loadingIndicator = reviewButton.querySelector('.loading-indicator');
                    if (loadingIndicator) {
                        reviewButton.removeChild(loadingIndicator);
                    }
                    reviewButton.innerHTML = 'Reviewed <i class="fas fa-check"></i>';
                    reviewButton.classList.remove('btn-primary');
                    reviewButton.classList.add('btn-success');
                }
            }, 8000); // 8 секунд ожидания
            
            return submission;
        });
    
    // Возвращаем null, так как результат будет обработан асинхронно
    return null;
}

// Функция для настройки обработчиков событий на панели преподавателя
function setupTeacherDashboardEventHandlers() {
    console.log('Setting up teacher dashboard event handlers - including DELETE functionality');
    
    // Handler for the reset data button
    const resetDataBtn = document.getElementById('resetDataBtn');
    if (resetDataBtn) {
        resetDataBtn.addEventListener('click', function() {
            console.log('Reset data button clicked');
            if (confirm('⚠️ WARNING: This will reset all data to demo values. Continue?')) {
                const result = forceResetData();
                if (result.success) {
                    alert('Data has been reset to demo values successfully!');
                } else {
                    alert('Failed to reset data: ' + result.message);
                }
            }
        });
    }
    
    // Explicitly add event listener for delete buttons
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('delete-assignment-btn') || e.target.closest('.delete-assignment-btn')) {
            const button = e.target.classList.contains('delete-assignment-btn') ? e.target : e.target.closest('.delete-assignment-btn');
            const assignmentId = parseInt(button.getAttribute('data-id'));
            console.log(`%c Delete button clicked for assignment ${assignmentId} %c`, 'background: red; color: white; font-weight: bold;', '');
            
            // Confirm before deleting
            if (confirm('Are you sure you want to delete this assignment? This will also delete all student submissions for this assignment and cannot be undone.')) {
                // Call the delete function
                if (deleteAssignment(assignmentId)) {
                    alert('Assignment deleted successfully');
                    // Update dashboard stats after deletion
                    updateTeacherDashboardStats();
                } else {
                    alert('Failed to delete assignment. Please try again.');
                }
            }
        }
    });
    
    // Add handlers for view report buttons
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('view-report-btn') || e.target.closest('.view-report-btn')) {
            const button = e.target.classList.contains('view-report-btn') ? e.target : e.target.closest('.view-report-btn');
            const submissionId = parseInt(button.getAttribute('data-id'));
            console.log(`View report button clicked for submission ${submissionId}`);
            
            // Show the analysis report
            showAnalysisReport(submissionId);
            
            // Update dashboard stats
            updateTeacherDashboardStats();
        }
    });
    
    // Обработчики для пунктов меню
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        item.addEventListener('click', function() {
            // Находим все пункты меню и убираем с них класс active
            menuItems.forEach(menuItem => menuItem.classList.remove('active'));
            // Добавляем класс active текущему пункту
            this.classList.add('active');
            
            const text = this.textContent.trim();
            
            if (text === 'Dashboard') {
                // Уже на панели управления
            } else if (text === 'Assignments') {
                // Прокрутка к разделу заданий
                document.querySelector('.assignments-section').scrollIntoView({ behavior: 'smooth' });
            } else if (text === 'Reviews') {
                // Прокрутка к разделу проверок
                document.querySelector('.reviews-section').scrollIntoView({ behavior: 'smooth' });
            } else if (text === 'Export') {
                alert('Export functionality will be available soon!');
            } else if (text === 'Analytics') {
                alert('Analytics will be available soon!');
            } else if (text === 'Settings') {
                alert('Settings will be available soon!');
            } else if (text === 'Logout') {
                logout();
            }
        });
    });
    
    // Обработчик для кнопки создания задания
    const createAssignmentBtn = document.querySelector('.create-assignment-btn');
    if (createAssignmentBtn) {
        createAssignmentBtn.addEventListener('click', function() {
            const modal = document.getElementById('createAssignmentModal');
            modal.classList.add('active');
        });
    }
    
    // Обработчик для закрытия модального окна
    const modalClose = document.querySelector('.modal-close');
    if (modalClose) {
        modalClose.addEventListener('click', function() {
            const modal = document.getElementById('createAssignmentModal');
            modal.classList.remove('active');
        });
    }
    
    // Обработчик для формы создания задания
    const assignmentForm = document.getElementById('assignmentForm');
    if (assignmentForm) {
        assignmentForm.addEventListener('submit', function(e) {
            e.preventDefault();
            
            // Получаем данные формы
            const title = document.getElementById('assignmentTitle').value;
            const description = document.getElementById('assignmentDescription').value;
            const dueDate = document.getElementById('assignmentDueDate').value;
            
            // Получаем эталонное решение
            const perfectSolutionFile = document.getElementById('perfectSolutionFile');
            
            // Проверка полей
            if (!title || !description || !dueDate) {
                alert('Please fill in all required fields');
                return;
            }
            
            if (!perfectSolutionFile || !perfectSolutionFile.files || perfectSolutionFile.files.length === 0) {
                alert('Please upload a perfect solution file (.ipynb)');
                return;
            }
            
            // Здесь мы бы обычно читали содержимое файла,
            // но для демонстрации просто сохраним имя файла
            const perfectSolution = perfectSolutionFile.files[0].name;
            
            // Создаем новое задание с использованием функции для демонстрации
            const newAssignment = createDemoAssignment(title, description, dueDate, perfectSolution);
            
            // Закрываем модальное окно и сбрасываем форму
            const modal = document.getElementById('createAssignmentModal');
            modal.classList.remove('active');
            assignmentForm.reset();
            
            // Сбрасываем отображение выбранного файла
            document.getElementById('selectedPerfectSolution').style.display = 'none';
            
            // Принудительно синхронизируем данные между панелями
            syncAssignmentsAndSubmissions();
            
            // Обновляем отображение заданий
            updateAssignmentsList();
            
            // Сообщаем об успешном создании
            alert(`Assignment "${title}" created successfully!`);
            
            console.log("Assignment created and saved to localStorage. All assignments:", assignments);
        });
    }
    
    // Обработчик для кнопок проверки решений
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('review-btn') || e.target.closest('.review-btn')) {
            const button = e.target.classList.contains('review-btn') ? e.target : e.target.closest('.review-btn');
            const submissionId = parseInt(button.getAttribute('data-id'));
            console.log(`Review button clicked for submission ${submissionId}`);
            
            // Находим отправку
            const submission = submissions.find(s => s.id === submissionId);
            if (submission) {
                // Показываем индикатор загрузки при необходимости
                const loadingElement = document.createElement('span');
                loadingElement.className = 'loading-indicator';
                loadingElement.innerHTML = ' <i class="fas fa-spinner fa-spin"></i> Loading review...';
                button.appendChild(loadingElement);
                button.disabled = true;
                
                // Use our new analyzeSubmission function instead
                analyzeSubmission(submissionId).then(analysis => {
                    // Remove loading indicator
                    const loadingIndicator = button.querySelector('.loading-indicator');
                    if (loadingIndicator) {
                        button.removeChild(loadingIndicator);
                    }
                    
                    // Update button appearance
                    button.disabled = false;
                    button.innerHTML = 'Reviewed <i class="fas fa-check"></i>';
                    button.classList.remove('btn-primary');
                    button.classList.add('btn-success');
                    
                    // Update the submission card
                    const submissionCard = button.closest('.submission-card');
                    if (submissionCard) {
                        submissionCard.classList.add('reviewed-submission');
                        
                        // Update status text
                        const statusElement = submissionCard.querySelector('.submission-status');
                        if (statusElement) {
                            statusElement.className = 'submission-status reviewed';
                            statusElement.innerHTML = `
                                <i class="fas fa-check-circle"></i> 
                                Reviewed: ${analysis.grade}/10
                            `;
                        }
                        
                        // Add the "View Report" button if it doesn't exist
                        if (!submissionCard.querySelector('.view-report-btn')) {
                            const actionsContainer = submissionCard.querySelector('.submission-actions');
                            if (actionsContainer) {
                                const reportButton = document.createElement('button');
                                reportButton.className = 'btn view-report-btn';
                                reportButton.setAttribute('data-id', submissionId);
                                reportButton.innerHTML = '<i class="fas fa-file-alt"></i> View Report';
                                actionsContainer.appendChild(reportButton);
                                
                                // Add event listener to the new button
                                reportButton.addEventListener('click', function() {
                                    showAnalysisReport(submissionId);
                                });
                            }
                        }
                    }
                    
                    // Show the report after analysis is complete
                    showAnalysisReport(submissionId);
                }).catch(error => {
                    console.error('Error during submission analysis:', error);
                    
                    // Remove loading indicator
                    const loadingIndicator = button.querySelector('.loading-indicator');
                    if (loadingIndicator) {
                        button.removeChild(loadingIndicator);
                    }
                    
                    // Re-enable button
                    button.disabled = false;
                    
                    // Alert the user
                    alert('There was an error analyzing this submission. Please try again.');
                });
            } else {
                console.error(`Submission with ID ${submissionId} not found`);
                alert('Submission not found.');
            }
        }
    });
    
    // Add Excel export setup
    setupExcelExport();
}

// Функция для настройки обработчиков событий на панели студента
function setupStudentDashboardEventHandlers() {
    console.log("Setting up student dashboard event handlers...");
    
    // Обработчики для пунктов меню
    const menuItems = document.querySelectorAll('.menu-item');
    menuItems.forEach(item => {
        item.addEventListener('click', function() {
            // Находим все пункты меню и убираем с них класс active
            menuItems.forEach(menuItem => menuItem.classList.remove('active'));
            // Добавляем класс active текущему пункту
            this.classList.add('active');
            
            const text = this.textContent.trim();
            
            if (text === 'Dashboard') {
                // On dashboard click, refresh the stats
                if (currentUser && currentUser.email) {
                    const studentEmail = currentUser.email;
                    const studentSubmissions = submissions.filter(sub => sub.studentEmail === studentEmail);
                    const submittedAssignmentIds = studentSubmissions.map(sub => sub.assignmentId);
                    const availableAssignments = assignments.filter(assignment => !submittedAssignmentIds.includes(assignment.id));
                    updateStudentDashboardStats(studentSubmissions, availableAssignments);
                }
            } else if (text === 'Assignments') {
                // Прокрутка к разделу заданий
                document.querySelector('.assignments-container').scrollIntoView({ behavior: 'smooth' });
            } else if (text === 'Submissions') {
                // Прокрутка к разделу работ
                document.querySelector('.recent-submissions').scrollIntoView({ behavior: 'smooth' });
            } else if (text === 'Progress') {
                alert('Progress tracking will be available soon!');
            } else if (text === 'Grades') {
                alert('Detailed grades will be available soon!');
            } else if (text === 'Settings') {
                alert('Settings will be available soon!');
            } else if (text === 'Logout') {
                logout();
            }
        });
    });
    
    // Обработчики для фильтров
    const filterButtons = document.querySelectorAll('.filter-btn, .tab-btn');
    filterButtons.forEach(button => {
        button.addEventListener('click', function() {
            // Находим все кнопки в текущей группе фильтров
            const filterGroup = this.closest('.assignments-filter, .tab-buttons');
            const buttons = filterGroup.querySelectorAll('.filter-btn, .tab-btn');
            
            // Убираем класс active со всех кнопок
            buttons.forEach(btn => btn.classList.remove('active'));
            
            // Добавляем класс active текущей кнопке
            this.classList.add('active');
        });
    });
    
    // Обработчик для кнопок отправки решения
    document.addEventListener('click', function(e) {
        if (e.target.classList.contains('submit-btn') || e.target.closest('.submit-btn')) {
            const button = e.target.classList.contains('submit-btn') ? e.target : e.target.closest('.submit-btn');
            const assignmentId = parseInt(button.getAttribute('data-id'));
            
            // Переходим на страницу отправки решения
            window.location.href = `submit-solution.html?id=${assignmentId}`;
        }
    });
    
    // Add refresh handler for any refresh button (future-proofing)
    const refreshBtn = document.querySelector('.refresh-btn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', function() {
            // Re-filter the data for the current student
            if (currentUser && currentUser.email) {
                const studentEmail = currentUser.email;
                const studentSubmissions = submissions.filter(sub => sub.studentEmail === studentEmail);
                const submittedAssignmentIds = studentSubmissions.map(sub => sub.assignmentId);
                const availableAssignments = assignments.filter(assignment => !submittedAssignmentIds.includes(assignment.id));
                
                // Update the dashboard with the most current data
                updateStudentDashboardStats(studentSubmissions, availableAssignments);
                updateStudentAssignmentsList(availableAssignments);
                updateStudentSubmissionsList(studentSubmissions);
            }
        });
    }
    
    console.log("Student dashboard event handlers set up successfully");
}

// Обработчик событий, который выполняется после полной загрузки страницы
document.addEventListener('DOMContentLoaded', function() {
    console.log("DOM fully loaded, syncing data...");
    syncAssignmentsAndSubmissions();
    // Остальной код инициализации
    checkAuthStatus();
    
    // Добавляем стили для анимации перехода между страницами
    const style = document.createElement('style');
    style.textContent = `
        .page-transition-overlay {
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background-color: #000;
            opacity: 0;
            z-index: 9999;
            transition: opacity 0.5s ease;
            pointer-events: none;
        }
    `;
    document.head.appendChild(style);
}); 

// Функция для предотвращения повторных запусков скрипта
(function() {
    // Проверяем, не загружен ли уже скрипт
    if (window.appInitialized) {
        console.log("App already initialized, preventing duplicate initialization");
        return;
    }
    
    // Отмечаем, что скрипт загружен
    window.appInitialized = true;
    
    console.log("App initialization guard set up");
})();

// Функция для экспорта данных в CSV
function exportAssignmentsToCSV() {
    // Проверяем, есть ли задания для экспорта
    if (assignments.length === 0) return '';
    
    // Заголовки CSV
    const headers = ['ID', 'Title', 'Description', 'Due Date', 'Created At', 'Created By', 'Max Points', 'Submissions Count', 'Reviewed Count', 'Avg Score'];
    
    // Формируем строки данных
    const rows = assignments.map(assignment => {
        const reviewedSubmissions = submissions.filter(sub => 
            sub.assignmentId === assignment.id && sub.status === 'reviewed'
        );
        
        const avgScore = reviewedSubmissions.length > 0 
            ? (reviewedSubmissions.reduce((sum, sub) => sum + sub.score, 0) / reviewedSubmissions.length).toFixed(2)
            : 'N/A';
            
        return [
            assignment.id,
            `"${assignment.title.replace(/"/g, '""')}"`,
            `"${(assignment.description || '').replace(/"/g, '""')}"`,
            assignment.dueDate,
            assignment.createdAt,
            assignment.createdBy,
            assignment.maxPoints,
            assignment.submissionsCount || 0,
            reviewedSubmissions.length,
            avgScore
        ];
    });
    
    // Объединяем всё в CSV-строку
    return [headers.join(',')].concat(rows.map(row => row.join(','))).join('\n');
}

// Функция для очистки localStorage и перезагрузки страницы
function resetDemo() {
    localStorage.removeItem('demoSubmissions');
    localStorage.removeItem('demoAssignments');
    window.location.reload();
}

// Функция для сброса данных (для отладки)
function resetStorage() {
    console.log("Resetting demo data in storage");
    localStorage.removeItem('demoSubmissions');
    localStorage.removeItem('demoAssignments');
    
    // Создаем новые демо-данные
    assignments = getDemoAssignments();
    submissions = getDemoSubmissions();
    
    // Сохраняем в localStorage
    localStorage.setItem('demoAssignments', JSON.stringify(assignments));
    localStorage.setItem('demoSubmissions', JSON.stringify(submissions));
    
    console.log("Demo data reset complete");
    
    // Обновляем интерфейс
    if (document.querySelector('.teacher-dashboard')) {
        updateAssignmentsList();
        updateSubmissionsList();
    } else if (document.querySelector('.student-dashboard')) {
        const studentEmail = currentUser.email;
        const studentSubmissions = submissions.filter(sub => sub.studentEmail === studentEmail);
        const submittedAssignmentIds = studentSubmissions.map(sub => sub.assignmentId);
        const availableAssignments = assignments.filter(assignment => !submittedAssignmentIds.includes(assignment.id));
        
        updateStudentAssignmentsList(availableAssignments);
        updateStudentSubmissionsList(studentSubmissions);
    }
}

// Feature Showcase Animations Handler
class FeatureShowcaseAnimations {
    constructor() {
        this.initialized = false;
        this.featureCards = document.querySelectorAll('.feature-card');
        this.matrixAnimations = document.querySelectorAll('.matrix-animation');
        this.errorAnimations = document.querySelectorAll('.error-detection-animation');
        this.notebookAnimations = document.querySelectorAll('.notebook-animation');
        
        this.init();
    }
    
    init() {
        if (this.initialized) return;
        
        // Initialize animations when elements are in viewport
        this.setupScrollAnimations();
        
        // Apply special effects to matrix animation
        this.setupMatrixAnimations();
        
        // Set up code animation effects
        this.setupCodeAnimations();
        
        // Set up notebook animation effects
        this.setupNotebookAnimations();
        
        this.initialized = true;
    }
    
    setupScrollAnimations() {
        const handleScroll = () => {
            this.featureCards.forEach(card => {
                if (this.isElementInViewport(card, 0.2)) {
                    const animation = card.getAttribute('data-animation');
                    if (animation) {
                        card.style.animationName = animation === 'slide-up' ? 'slideUp' : 'slideRight';
                        card.style.animationDuration = '0.8s';
                        card.style.animationFillMode = 'forwards';
                    }
                    card.classList.add('visible');
                }
            });
        };
        
        // Initial check
        setTimeout(handleScroll, 500);
        
        // On scroll
        window.addEventListener('scroll', handleScroll);
    }
    
    setupMatrixAnimations() {
        this.matrixAnimations.forEach(matrixAnim => {
            const matrix = matrixAnim.querySelector('.matrix-grid');
            const cells = matrixAnim.querySelectorAll('.matrix-grid span');
            const result = matrixAnim.querySelector('.matrix-result');
            
            // Add interactive hover effect
            cells.forEach(cell => {
                // Random delay for the pulse animation
                const delay = Math.random() * 3;
                cell.style.animationDelay = `${delay}s`;
                
                // Add hover effect
                cell.addEventListener('mouseover', () => {
                    cell.style.color = '#e74c3c';
                    cell.style.backgroundColor = 'rgba(231, 76, 60, 0.2)';
                    cell.style.transform = 'scale(1.1)';
                });
                
                cell.addEventListener('mouseout', () => {
                    cell.style.color = '';
                    cell.style.backgroundColor = '';
                    cell.style.transform = '';
                });
            });
            
            // Add 3D matrix rotation on mouse move
            matrixAnim.addEventListener('mousemove', (e) => {
                const rect = matrixAnim.getBoundingClientRect();
                const x = e.clientX - rect.left - rect.width / 2;
                const y = e.clientY - rect.top - rect.height / 2;
                
                const tiltX = y / rect.height * 10;
                const tiltY = -x / rect.width * 10;
                
                matrix.style.transform = `rotateX(${tiltX}deg) rotateY(${tiltY}deg)`;
            });
            
            // Reset rotation when mouse leaves
            matrixAnim.addEventListener('mouseleave', () => {
                matrix.style.transition = 'transform 0.5s ease';
                matrix.style.transform = 'rotateX(0deg) rotateY(0deg)';
                setTimeout(() => {
                    matrix.style.transition = '';
                }, 500);
            });
        });
    }
    
    setupCodeAnimations() {
        this.errorAnimations.forEach(errorAnim => {
            const errorLine = errorAnim.querySelector('.code-line.error');
            const errorHighlight = errorAnim.querySelector('.error-highlight');
            
            if (errorLine && errorHighlight) {
                // Make the error line interactive
                errorLine.addEventListener('mouseover', () => {
                    errorLine.style.background = 'rgba(231, 76, 60, 0.4)';
                    errorHighlight.style.transform = 'translateY(0)';
                    errorHighlight.style.opacity = '1';
                });
                
                errorLine.addEventListener('mouseout', () => {
                    errorLine.style.background = '';
                    errorHighlight.style.transform = '';
                    errorHighlight.style.opacity = '';
                });
            }
        });
    }
    
    setupNotebookAnimations() {
        this.notebookAnimations.forEach(notebook => {
            const dots = notebook.querySelectorAll('.processing-dots span');
            const results = notebook.querySelector('.cell-result');
            
            // Reset animations when the element comes into view
            const resetAnimation = () => {
                if (this.isElementInViewport(notebook)) {
                    // Reset processing dots animation
                    dots.forEach((dot, index) => {
                        dot.style.animation = 'none';
                        setTimeout(() => {
                            dot.style.animation = `dotPulse 1.5s ${index * 0.2}s infinite`;
                        }, 10);
                    });
                    
                    // Reset result animation
                    if (results) {
                        results.style.animation = 'none';
                        setTimeout(() => {
                            results.style.animation = 'resultSlideIn 0.5s 2s forwards';
                        }, 10);
                    }
                }
            };
            
            // Check on scroll
            window.addEventListener('scroll', resetAnimation);
            
            // Initial check
            setTimeout(resetAnimation, 500);
        });
    }
    
    isElementInViewport(el, offset = 0) {
        const rect = el.getBoundingClientRect();
        const windowHeight = window.innerHeight || document.documentElement.clientHeight;
        
        return (
            rect.top <= windowHeight * (1 - offset) &&
            rect.bottom >= windowHeight * offset
        );
    }
}

// Initialize feature showcase animations when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    const featureAnimations = new FeatureShowcaseAnimations();
    
    // Reinitialize on window resize
    window.addEventListener('resize', () => {
        featureAnimations.init();
    });
}); 

// Function to analyze a student submission against the reference solution
async function analyzeSubmission(submissionId) {
    console.log(`%c ANALYZING SUBMISSION ${submissionId} %c`, 'background: blue; color: white; font-weight: bold;', '');
    
    try {
    // Find the submission
    const submission = submissions.find(s => s.id === submissionId);
    if (!submission) {
            throw new Error(`Submission with ID ${submissionId} not found`);
        }
        
        console.log("Found submission to analyze:", submission);
        
        // First, check if the submission already has an analysis
        if (submission.analysis) {
            console.log("Submission already has analysis, returning existing data");
            
            // Update dashboard stats
            updateTeacherDashboardStats();
            
            return submission.analysis;
    }
    
        // Find the associated assignment
    const assignment = assignments.find(a => a.id === submission.assignmentId);
    if (!assignment) {
            throw new Error(`Assignment with ID ${submission.assignmentId} not found`);
        }
        
        console.log("Found associated assignment:", assignment);
        
        // In a real implementation with real API calls:
        let analysis;
        
        // Check if we should use the Python server API or mock data
        const useRealAPI = true; // Set to true to use the real API, false to use mock data
        
        if (useRealAPI) {
            console.log("Attempting to use real Python server API for analysis");
            
            try {
                // Create FormData for the API request
            const formData = new FormData();
            
                // Add notebook files - for demo purposes, we're loading files from constants
                // In a real application, these would come from actual file uploads
                let studentFile, perfectFile;
                
                // Load the appropriate notebook files based on assignment type
                if (assignment.title.toLowerCase().includes('ellipse')) {
                    console.log("Loading ellipse-specific notebook files");
                    
                    // Create blob objects from the notebook file contents
                    const studentBlob = new Blob([submission.solution || '{}'], { type: 'application/json' });
                    studentFile = new File([studentBlob], 'student_solution_ellipse.ipynb');
                    
                    const perfectBlob = new Blob([assignment.perfectSolution || '{}'], { type: 'application/json' });
                    perfectFile = new File([perfectBlob], 'perfect_solution_ellipse.ipynb');
                } else {
                    console.log("Loading general notebook files");
                    
                    // Alternative approach: load from predefined files
                    // We'll simulate this with a fetch request to get the file contents
                    try {
                        // Get student notebook from file
            const studentResponse = await fetch('student_solution.ipynb');
                        const studentContent = await studentResponse.text();
                        const studentBlob = new Blob([studentContent], { type: 'application/json' });
                        studentFile = new File([studentBlob], 'student_solution.ipynb');
                        
                        // Get perfect solution notebook from file
                        const perfectResponse = await fetch('perfect_solution.ipynb');
                        const perfectContent = await perfectResponse.text();
                        const perfectBlob = new Blob([perfectContent], { type: 'application/json' });
                        perfectFile = new File([perfectBlob], 'perfect_solution.ipynb');
                    } catch (fileError) {
                        console.error("Error loading notebook files:", fileError);
                        // Fallback to string versions if files can't be loaded
                        const studentBlob = new Blob([submission.solution || '{}'], { type: 'application/json' });
                        studentFile = new File([studentBlob], 'student_solution.ipynb');
                        
                        const perfectBlob = new Blob([assignment.perfectSolution || '{}'], { type: 'application/json' });
                        perfectFile = new File([perfectBlob], 'perfect_solution.ipynb');
                    }
                }
                
                // Add files and task ID to the form data
                formData.append('notebook_file', studentFile);
                formData.append('reference_solution', perfectFile);
                formData.append('task_id', assignment.id.toString());
                
                // Display a notification
                console.log("Sending notebooks to analysis API...");
                
                // Send the API request
                const apiUrl = 'http://localhost:8000/api/analyze';
                console.log(`Sending request to ${apiUrl}`);
                
                // Display detailed info about the request
                console.log("Request details:", {
                    studentFile: studentFile.name,
                    studentFileSize: studentFile.size,
                    perfectFile: perfectFile.name,
                    perfectFileSize: perfectFile.size,
                    taskId: assignment.id
                });
                
                const response = await fetch(apiUrl, {
                method: 'POST',
                    body: formData,
                    // Allow credentials and set proper CORS headers
                    credentials: 'include',
                    mode: 'cors'
            });
            
                if (!response.ok) {
                    throw new Error(`API error: ${response.status} ${response.statusText}`);
                }
                
                // Parse the API response
                const apiResult = await response.json();
                console.log("Received analysis from API:", apiResult);
                
                // Use the result from the API
                analysis = apiResult;
            } catch (apiError) {
                console.error("Error calling Python API:", apiError);
                console.log("Falling back to mock analysis");
                // Fall back to mock data if the API call fails
                analysis = getDemoAIAnalysis(assignment.id, submission);
            }
        } else {
            // Use mock data for demo purposes
            console.log("Using mock analysis data");
            analysis = getDemoAIAnalysis(assignment.id, submission);
        }
        
        console.log("Generated analysis:", analysis);
        
        // Update submission status and other fields
        submission.status = 'reviewed';
        submission.score = analysis.grade;
        submission.aiConfidence = analysis.confidence_score;
        submission.feedback = analysis.error_summary;
        submission.reviewedAt = new Date().toISOString();
        submission.analysis = analysis;
        
        // Update the submission in the submissions array
        const submissionIndex = submissions.findIndex(s => s.id === submissionId);
        if (submissionIndex !== -1) {
            submissions[submissionIndex] = submission;
        
            // Update in localStorage
            localStorage.setItem('demoSubmissions', JSON.stringify(submissions));
            console.log(`Updated submission with ID ${submissionId} in localStorage`);
        }
        
        // Update the assignment's reviewed count
        if (assignment) {
        assignment.reviewedCount = (assignment.reviewedCount || 0) + 1;
            const assignmentIndex = assignments.findIndex(a => a.id === assignment.id);
            if (assignmentIndex !== -1) {
                assignments[assignmentIndex] = assignment;
        
                // Update in localStorage
        localStorage.setItem('demoAssignments', JSON.stringify(assignments));
                console.log(`Updated assignment with ID ${assignment.id} in localStorage`);
            }
        }
        
        // Update dashboard stats
        updateTeacherDashboardStats();
        
        return analysis;
    } catch (error) {
        console.error("Error analyzing submission:", error);
        throw error;
    }
}

// Function to delete an assignment
function deleteAssignment(assignmentId) {
    console.log(`%c DELETE ASSIGNMENT ${assignmentId} %c`, 'background: red; color: white; font-weight: bold;', '');
    
    try {
        // Find the assignment
    const assignmentIndex = assignments.findIndex(a => a.id === assignmentId);
    if (assignmentIndex === -1) {
        console.error(`Assignment with ID ${assignmentId} not found`);
        return false;
    }
    
    // Remove the assignment from the array
        const removedAssignment = assignments.splice(assignmentIndex, 1)[0];
        console.log(`Removed assignment: ${removedAssignment.title}`);
    
        // Also remove any submissions for this assignment
        const relatedSubmissions = submissions.filter(s => s.assignmentId === assignmentId);
        if (relatedSubmissions.length > 0) {
            console.log(`Found ${relatedSubmissions.length} submissions to delete for this assignment`);
            
            // Remove the submissions
    submissions = submissions.filter(s => s.assignmentId !== assignmentId);
            console.log(`Removed ${relatedSubmissions.length} submissions`);
    
            // Update localStorage
    localStorage.setItem('demoSubmissions', JSON.stringify(submissions));
        }
    
        // Save the updated assignments to localStorage
        localStorage.setItem('demoAssignments', JSON.stringify(assignments));
    
        // Update the assignments list on the page
    updateAssignmentsList();
        
        // If we're showing all submissions, update that too
    updateSubmissionsList();
        
        // Update dashboard stats
        updateTeacherDashboardStats();
    
    return true;
    } catch (error) {
        console.error('Error deleting assignment:', error);
        return false;
    }
}

// Function to force refresh data on teacher dashboard
function forceRefreshData() {
    console.log("%c FORCING DATA REFRESH %c", 'background: red; color: white; font-weight: bold;', '');
    
    // Show loading indicator
    const refreshBtn = document.getElementById('refreshDataBtn');
    if (refreshBtn) {
        const originalText = refreshBtn.innerHTML;
        refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Refreshing...';
        refreshBtn.disabled = true;
        
        setTimeout(() => {
            // Clear memory arrays
            assignments = [];
            submissions = [];
            
            // Force reload data
            syncAssignmentsAndSubmissions();
            
            // Update UI
            updateAssignmentsList();
            updateSubmissionsList();
            
            // Restore button
            refreshBtn.innerHTML = originalText;
            refreshBtn.disabled = false;
            
            // Show success message
            alert('Data refreshed successfully!');
            
            console.log("%c DATA REFRESH COMPLETE %c", 'background: green; color: white; font-weight: bold;', '');
        }, 1000);
    } else {
        // No button found, just refresh
        assignments = [];
        submissions = [];
        syncAssignmentsAndSubmissions();
        updateAssignmentsList();
        updateSubmissionsList();
        alert('Data refreshed successfully!');
    }
}

// Function to force reset all data and recreate from scratch
function forceResetData() {
    console.log("%c FORCE RESETTING ALL DATA %c", 'background: red; color: white; font-weight: bold;', '');
    
    try {
        // Generate fresh demo data
        const demoAssignments = getDemoAssignments();
        const demoSubmissions = getDemoSubmissions();
        
        // Clear existing data
        localStorage.removeItem('assignments');
        localStorage.removeItem('submissions');
        localStorage.removeItem('demoAssignments');
        localStorage.removeItem('demoSubmissions');
        
        // Save new demo data
        localStorage.setItem('demoAssignments', JSON.stringify(demoAssignments));
        localStorage.setItem('demoSubmissions', JSON.stringify(demoSubmissions));
        
        // Update global variables
        assignments = demoAssignments;
        submissions = demoSubmissions;
        
        console.log(`Reset complete. Now have ${assignments.length} assignments and ${submissions.length} submissions`);
        
        // Update UI if we're on the teacher dashboard
        if (window.location.pathname.includes('teacher-dashboard')) {
            // Update the lists
        updateAssignmentsList();
        updateSubmissionsList();
        
            // Update the dashboard stats
            updateTeacherDashboardStats();
            
            console.log('Teacher dashboard UI updated after reset');
        } else if (window.location.pathname.includes('student-dashboard')) {
            // Update student dashboard UI
            console.log('Student dashboard detected, updating UI...');
            
            // Filter data for the current student
            if (currentUser && currentUser.email) {
                const studentEmail = currentUser.email;
                const studentSubmissions = submissions.filter(sub => sub.studentEmail === studentEmail);
                const submittedAssignmentIds = studentSubmissions.map(sub => sub.assignmentId);
                const availableAssignments = assignments.filter(assignment => !submittedAssignmentIds.includes(assignment.id));
                
                // Update the dashboard stats
                updateStudentDashboardStats(studentSubmissions, availableAssignments);
                
                // Update assignments and submissions lists
                updateStudentAssignmentsList(availableAssignments);
                updateStudentSubmissionsList(studentSubmissions);
                
                console.log('Student dashboard UI updated after reset');
            } else {
                console.error('Cannot update student dashboard: no current user');
            }
        }
        
        return { success: true, message: 'Data reset successful' };
    } catch (error) {
        console.error('Error during data reset:', error);
        return { success: false, message: error.message };
    }
}

// PDF Generation Functions
function generateReportPDF(elementId, filename) {
    return new Promise((resolve, reject) => {
        // Show loading state on the page
        const loadingElement = document.createElement('div');
        loadingElement.className = 'pdf-loading-overlay';
        loadingElement.innerHTML = `
            <div class="pdf-loading-content">
                <i class="fas fa-spinner fa-spin"></i>
                <span>Generating PDF...</span>
            </div>
        `;
        document.body.appendChild(loadingElement);
        
        // Get the element to convert
        const element = document.getElementById(elementId);
        
        // Create an enhanced version for PDF export
        const pdfElement = createPDFOptimizedReport(element);
        
        // Create a temporary container for the PDF version
        const tempContainer = document.createElement('div');
        tempContainer.style.position = 'absolute';
        tempContainer.style.left = '-9999px';
        tempContainer.style.top = '-9999px';
        tempContainer.style.width = '210mm'; // Set explicit A4 width
        tempContainer.style.margin = '0 auto';
        tempContainer.appendChild(pdfElement);
        document.body.appendChild(tempContainer);
        
        // Wait a bit to ensure styles are applied before conversion
        setTimeout(() => {
            // Configure html2pdf options with improved settings
            const options = {
                margin: [10, 10, 10, 10], // Add small margins on all sides
                filename: filename,
                image: { type: 'jpeg', quality: 1.0 },
                html2canvas: { 
                    scale: 2, 
                    useCORS: true, 
                    logging: false,
                    backgroundColor: '#1e293b',
                    width: 794, // A4 width in pixels (approximately) at 96 DPI
                    height: 1123, // A4 height in pixels
                    removeContainer: true,
                    letterRendering: true,
                    allowTaint: true,
                    foreignObjectRendering: false,
                    imageTimeout: 15000,
                    // Critical fix: don't clip content to canvas size
                    scrollY: 0,
                    scrollX: 0,
                    windowHeight: 3000, // Increased to ensure tall content is captured
                    onclone: function(clonedDoc) {
                        // Additional modifications to cloned document before rendering
                        const style = clonedDoc.createElement('style');
                        style.innerHTML = `
                            body, html { 
                                background-color: #1e293b !important;
                                margin: 0 !important;
                                padding: 0 !important;
                                overflow: visible !important; /* Changed from hidden to visible */
                                width: 210mm !important;
                                box-sizing: border-box !important;
                                height: auto !important; /* Allow document to expand */
                            }
                            .report-container { 
                                background-color: #1e293b !important;
                                width: 100% !important;
                                max-width: 210mm !important;
                                box-sizing: border-box !important;
                                margin: 0 !important;
                                padding: 0 !important;
                                overflow: visible !important; /* Changed from hidden to visible */
                            }
                            .report-section { 
                                background-color: rgba(15, 23, 42, 0.6) !important;
                                width: 100% !important;
                                box-sizing: border-box !important;
                                overflow: visible !important; /* Changed from hidden to visible */
                                page-break-inside: avoid !important;
                                margin-bottom: 15px !important;
                            }
                            .error-highlight { 
                                background-color: rgba(239, 68, 68, 0.1) !important;
                                border-left: 4px solid #ef4444 !important;
                                width: 100% !important;
                                box-sizing: border-box !important;
                                overflow: visible !important; /* Changed from hidden to visible */
                                page-break-inside: avoid !important;
                            }
                            * {
                                box-sizing: border-box !important;
                                word-wrap: break-word !important;
                                overflow-wrap: break-word !important;
                            }
                            .pdf-document {
                                overflow: visible !important;
                            }
                            .pdf-document > div {
                                overflow: visible !important;
                            }
                            /* Add specific page break rules */
                            h2.section-title {
                                page-break-before: auto !important;
                                page-break-after: avoid !important;
                            }
                            .error-header, .cell-header {
                                page-break-after: avoid !important;
                            }
                            .feedback-item {
                                page-break-inside: avoid !important;
                            }
                        `;
                        clonedDoc.head.appendChild(style);
                        
                        // Make all elements visible
                        const allElements = clonedDoc.querySelectorAll('*');
                        allElements.forEach(el => {
                            if (el.style) {
                                el.style.overflow = 'visible';
                            }
                        });
                    }
                },
                jsPDF: { 
                    unit: 'mm', 
                    format: 'a4', 
                    orientation: 'portrait',
                    compress: true,
                    precision: 16,
                    putOnlyUsedFonts: true,
                    hotfixes: ["px_scaling"],
                    // Set font options for better text rendering
                    fontOptions: {
                        subset: true
                    }
                },
                // Improved paging options
                pagebreak: { 
                    mode: ['avoid-all', 'css', 'legacy'],
                    before: '.report-section',
                    after: ['.pdf-cover-page', '.page-break'],
                    avoid: ['h2', '.error-header', '.cell-header']
                }
            };
            
            // Generate the PDF
            html2pdf()
                .set(options)
                .from(pdfElement)
                .save()
                .then(() => {
                    // Remove temporary elements
                    document.body.removeChild(loadingElement);
                    document.body.removeChild(tempContainer);
                    resolve();
                })
                .catch(error => {
                    console.error("PDF generation error:", error);
                    // Clean up even on error
                    document.body.removeChild(loadingElement);
                    document.body.removeChild(tempContainer);
                    reject(error);
                });
        }, 1000); // Increased delay to ensure styles are applied
    });
}

// Function to generate a PDF preview
function previewReportPDF(elementId, previewContainerId) {
    return new Promise((resolve, reject) => {
        // Show loading state on the preview container
        const previewContainer = document.getElementById(previewContainerId);
        if (!previewContainer) {
            console.error(`Preview container with ID "${previewContainerId}" not found`);
            reject(new Error(`Preview container not found: ${previewContainerId}`));
            return;
        }
        
        previewContainer.innerHTML = `
            <div style="display: flex; justify-content: center; align-items: center; height: 100%;">
                <div style="text-align: center;">
                    <i class="fas fa-spinner fa-spin" style="font-size: 30px; margin-bottom: 15px;"></i>
                    <p>Generating PDF preview...</p>
                </div>
            </div>
        `;
        
        // Get the element to convert
        const element = document.getElementById(elementId);
        if (!element) {
            console.error(`Element with ID "${elementId}" not found`);
            previewContainer.innerHTML = `
                <div style="text-align: center; padding: 20px;">
                    <i class="fas fa-exclamation-triangle" style="color: #ef4444; font-size: 30px; margin-bottom: 15px;"></i>
                    <p>Error: Could not find the report element. Please try again.</p>
                </div>
            `;
            reject(new Error(`Element not found: ${elementId}`));
            return;
        }
        
        // Create an enhanced version for PDF export
        const pdfElement = createPDFOptimizedReport(element);
        
        // Create a temporary container for the PDF version
        const tempContainer = document.createElement('div');
        tempContainer.style.position = 'absolute';
        tempContainer.style.left = '-9999px';
        tempContainer.style.top = '-9999px';
        tempContainer.style.width = '210mm'; // Set explicit A4 width
        tempContainer.style.margin = '0 auto';
        tempContainer.appendChild(pdfElement);
        document.body.appendChild(tempContainer);
        
        // Wait a bit to ensure styles are applied before conversion
        setTimeout(() => {
            // Configure html2pdf options with improved settings
            const options = {
                margin: [10, 10, 10, 10], // Add small margins on all sides
                filename: 'preview.pdf',
                image: { type: 'jpeg', quality: 1.0 },
                html2canvas: { 
                    scale: 2, 
                    useCORS: true, 
                    logging: false,
                    backgroundColor: '#1e293b',
                    width: 794, // A4 width in pixels (approximately) at 96 DPI
                    height: 1123, // A4 height in pixels
                    removeContainer: true,
                    letterRendering: true,
                    allowTaint: true,
                    foreignObjectRendering: false,
                    imageTimeout: 15000,
                    // Critical fix: don't clip content to canvas size
                    scrollY: 0,
                    scrollX: 0,
                    windowHeight: 3000, // Increased to ensure tall content is captured
                    onclone: function(clonedDoc) {
                        // Additional modifications to cloned document before rendering
                        const style = clonedDoc.createElement('style');
                        style.innerHTML = `
                            body, html { 
                                background-color: #1e293b !important;
                                margin: 0 !important;
                                padding: 0 !important;
                                overflow: visible !important; /* Changed from hidden to visible */
                                width: 210mm !important;
                                box-sizing: border-box !important;
                                height: auto !important; /* Allow document to expand */
                            }
                            .report-container { 
                                background-color: #1e293b !important;
                                width: 100% !important;
                                max-width: 210mm !important;
                                box-sizing: border-box !important;
                                margin: 0 !important;
                                padding: 0 !important;
                                overflow: visible !important; /* Changed from hidden to visible */
                            }
                            .report-section { 
                                background-color: rgba(15, 23, 42, 0.6) !important;
                                width: 100% !important;
                                box-sizing: border-box !important;
                                overflow: visible !important; /* Changed from hidden to visible */
                                page-break-inside: avoid !important;
                                margin-bottom: 15px !important;
                            }
                            .error-highlight { 
                                background-color: rgba(239, 68, 68, 0.1) !important;
                                border-left: 4px solid #ef4444 !important;
                                width: 100% !important;
                                box-sizing: border-box !important;
                                overflow: visible !important; /* Changed from hidden to visible */
                                page-break-inside: avoid !important;
                            }
                            * {
                                box-sizing: border-box !important;
                                word-wrap: break-word !important;
                                overflow-wrap: break-word !important;
                            }
                            .pdf-document {
                                overflow: visible !important;
                            }
                            .pdf-document > div {
                                overflow: visible !important;
                            }
                            /* Add specific page break rules */
                            h2.section-title {
                                page-break-before: auto !important;
                                page-break-after: avoid !important;
                            }
                            .error-header, .cell-header {
                                page-break-after: avoid !important;
                            }
                            .feedback-item {
                                page-break-inside: avoid !important;
                            }
                        `;
                        clonedDoc.head.appendChild(style);
                        
                        // Make all elements visible
                        const allElements = clonedDoc.querySelectorAll('*');
                        allElements.forEach(el => {
                            if (el.style) {
                                el.style.overflow = 'visible';
                            }
                        });
                    }
                },
                jsPDF: { 
                    unit: 'mm', 
                    format: 'a4', 
                    orientation: 'portrait',
                    compress: true,
                    precision: 16,
                    putOnlyUsedFonts: true,
                    hotfixes: ["px_scaling"],
                    // Set font options for better text rendering
                    fontOptions: {
                        subset: true
                    }
                },
                // Improved paging options
                pagebreak: { 
                    mode: ['avoid-all', 'css', 'legacy'],
                    before: '.report-section',
                    after: ['.pdf-cover-page', '.page-break'],
                    avoid: ['h2', '.error-header', '.cell-header']
                }
            };
            
            // Generate the PDF as data URI
            html2pdf()
                .set(options)
                .from(pdfElement)
                .outputPdf('datauristring')
                .then(pdfString => {
                    // Display PDF in preview container
                    previewContainer.innerHTML = `<iframe src="${pdfString}" width="100%" height="100%"></iframe>`;
                    
                    // Remove temporary container
                    document.body.removeChild(tempContainer);
                    resolve(pdfString);
                })
                .catch(error => {
                    console.error("PDF preview error:", error);
                    previewContainer.innerHTML = `
                        <div style="text-align: center; padding: 20px;">
                            <i class="fas fa-exclamation-triangle" style="color: #ef4444; font-size: 30px; margin-bottom: 15px;"></i>
                            <p>Error generating PDF preview. Please try again.</p>
                        </div>
                    `;
                    
                    // Clean up even on error
                    document.body.removeChild(tempContainer);
                    reject(error);
                });
        }, 1000); // Increased delay to ensure styles are applied
    });
}

// Duplicate analyzeSubmission function was removed from here (fixed conflict with main implementation at line 3536)

// Add helper function to handle API errors in PDF generation
function handleAPIErrorInPDF(container) {
    // Check if there's an API error in the analysis
    const summaryElement = container.querySelector('#summaryContent');
    if (summaryElement && summaryElement.textContent.includes('403 Forbidden')) {
        // Create an error message element
        const errorElement = document.createElement('div');
        errorElement.className = 'api-error-message';
        errorElement.innerHTML = `
            <h3 style="color: #e74c3c;">API Connection Error</h3>
            <p>Unable to connect to the OpenAI API. The server returned a 403 Forbidden error.</p>
            <p>This typically indicates an authentication issue with your API credentials.</p>
            <ul>
                <li>Check that your OpenAI API key is valid and has not expired</li>
                <li>Verify you have sufficient credits in your account</li>
                <li>Make sure your API endpoint URL is correct</li>
                <li>If using a proxy service, ensure it's operational</li>
            </ul>
        `;
        
        // Insert the error message at the top of the report
        const reportContainer = container.querySelector('.report-container');
        if (reportContainer) {
            reportContainer.insertBefore(errorElement, reportContainer.firstChild);
        }
    }
}

// Function to display the analysis loading state
function displayAnalysisLoading() {
    console.log("Displaying analysis loading state");
    // Try to find a loading overlay element
    const loadingOverlay = document.getElementById('loadingOverlay');
    if (loadingOverlay) {
        loadingOverlay.style.display = 'flex';
    } else {
        // If we're on the analysis report page, update the container
        const reportContainer = document.querySelector('.report-container');
        if (reportContainer) {
            reportContainer.innerHTML = `
                <div style="text-align: center; padding: 50px;">
                    <div style="font-size: 50px; margin-bottom: 20px;">
                        <i class="fas fa-spinner fa-spin"></i>
                    </div>
                    <h2>Анализ решения...</h2>
                    <p>Пожалуйста, подождите, пока наш ИИ анализирует решение студента.</p>
                </div>
            `;
        }
    }
}

// Function to handle Excel export button click
function setupExcelExport() {
    console.log("Setting up Excel export functionality...");
    
    const exportBtn = document.getElementById('exportExcelBtn');
    if (!exportBtn) {
        console.warn("Export Excel button not found");
        return;
    }
    
    const exportModal = document.getElementById('exportModal');
    const exportModalClose = document.querySelector('.export-modal-close');
    const cancelBtn = document.querySelector('.export-cancel-btn');
    const confirmBtn = document.querySelector('.export-confirm-btn');
    
    // Open export modal on button click
    exportBtn.addEventListener('click', () => {
        console.log("Opening export modal");
        populateExportAssignmentsList();
        exportModal.style.display = 'block';
    });
    
    // Close modal when clicking the X button
    if (exportModalClose) {
        exportModalClose.addEventListener('click', () => {
            exportModal.style.display = 'none';
        });
    }
    
    // Close modal when clicking Cancel
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            exportModal.style.display = 'none';
        });
    }
    
    // Handle export confirmation
    if (confirmBtn) {
        confirmBtn.addEventListener('click', () => {
            exportSelectedAssignments();
        });
    }
    
    // Close modal when clicking outside of it
    window.addEventListener('click', (event) => {
        if (event.target === exportModal) {
            exportModal.style.display = 'none';
        }
    });
}

// Populate the export modal with assignments
function populateExportAssignmentsList() {
    console.log("Populating export assignments list");
    
    const exportAssignmentList = document.getElementById('exportAssignmentList');
    if (!exportAssignmentList) {
        console.error("Export assignment list element not found");
        return;
    }
    
    // Clear existing items
    exportAssignmentList.innerHTML = '';
    
    // Load assignments from local storage or app state
    let assignments = [];
    try {
        assignments = JSON.parse(localStorage.getItem('demoAssignments') || '[]');
    } catch (error) {
        console.error("Error loading assignments:", error);
        assignments = window.assignments || [];
    }
    
    if (!assignments || assignments.length === 0) {
        exportAssignmentList.innerHTML = '<p>No assignments available for export.</p>';
        return;
    }
    
    // Create checkbox items for each assignment
    assignments.forEach(assignment => {
        const item = document.createElement('div');
        item.className = 'export-assignment-item';
        
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = `export-assignment-${assignment.id}`;
        checkbox.value = assignment.id;
        
        const label = document.createElement('label');
        label.htmlFor = `export-assignment-${assignment.id}`;
        label.textContent = assignment.title;
        
        item.appendChild(checkbox);
        item.appendChild(label);
        exportAssignmentList.appendChild(item);
    });
}

// Export selected assignments
function exportSelectedAssignments() {
    console.log("Exporting selected assignments");
    
    // Get all checked assignments
    const selectedIds = [];
    document.querySelectorAll('.export-assignment-item input[type="checkbox"]:checked').forEach(checkbox => {
        selectedIds.push(parseInt(checkbox.value));
    });
    
    if (selectedIds.length === 0) {
        alert("Please select at least one assignment to export.");
        return;
    }
    
    console.log("Selected assignment IDs:", selectedIds);
    
    // For each selected assignment, call the export API
    selectedIds.forEach(taskId => {
        exportAssignmentReport(taskId);
    });
    
    // Close the modal
    document.getElementById('exportModal').style.display = 'none';
}

// Function to call the backend API to generate Excel file
function exportAssignmentReport(taskId) {
    console.log(`Exporting report for assignment ID: ${taskId}`);
    
    // Create a loading indicator
    const loadingToast = document.createElement('div');
    loadingToast.className = 'toast info-toast';
    loadingToast.innerHTML = `
        <div class="toast-icon"><i class="fas fa-spinner fa-spin"></i></div>
        <div class="toast-content">
            <div class="toast-title">Generating Excel Report</div>
            <div class="toast-message">Please wait while we prepare your report...</div>
        </div>
    `;
    document.body.appendChild(loadingToast);
    
    // Get the data from localStorage for this demo
    // In a real app, this would be a direct API call
    setTimeout(() => {
        try {
            // In a real app, this would be the API URL
            const apiUrl = `${API_BASE_URL}/export-report/${taskId}`;
            console.log(`Calling API: ${apiUrl}`);
            
            // Create an anchor element for the download
            const downloadLink = document.createElement('a');
            downloadLink.href = apiUrl;
            downloadLink.download = `proofmate_report_${taskId}.xlsx`;
            
            // Trigger the download
            document.body.appendChild(downloadLink);
            downloadLink.click();
            document.body.removeChild(downloadLink);
            
            // Remove loading toast and show success
            document.body.removeChild(loadingToast);
            
            // Show success toast
            const successToast = document.createElement('div');
            successToast.className = 'toast success-toast';
            successToast.innerHTML = `
                <div class="toast-icon"><i class="fas fa-check-circle"></i></div>
                <div class="toast-content">
                    <div class="toast-title">Export Successful</div>
                    <div class="toast-message">Report for assignment #${taskId} has been downloaded.</div>
                </div>
            `;
            document.body.appendChild(successToast);
            
            // Remove the success toast after a few seconds
            setTimeout(() => {
                document.body.removeChild(successToast);
            }, 5000);
        } catch (error) {
            console.error(`Error exporting report for assignment ${taskId}:`, error);
            
            // Remove loading toast and show error
            document.body.removeChild(loadingToast);
            
            // Show error toast
            const errorToast = document.createElement('div');
            errorToast.className = 'toast error-toast';
            errorToast.innerHTML = `
                <div class="toast-icon"><i class="fas fa-exclamation-triangle"></i></div>
                <div class="toast-content">
                    <div class="toast-title">Export Failed</div>
                    <div class="toast-message">Could not export report for assignment #${taskId}. Please try again.</div>
                </div>
            `;
            document.body.appendChild(errorToast);
            
            // Remove the error toast after a few seconds
            setTimeout(() => {
                document.body.removeChild(errorToast);
            }, 5000);
        }
    }, 1000); // Simulate API delay
}