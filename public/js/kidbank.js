// KidBank - JavaScript Functions
// ================================

// Tab Switching
function switchTab(tabName) {
    // Hide all tab contents
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.remove('active');
    });

    // Remove active class from all buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Show selected tab content
    document.getElementById(tabName).classList.add('active');

    // Add active class to clicked button
    document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
}

// Task Completion
async function completeTask(button, taskId) {
    try {
        const response = await fetch('/dashboard/api/complete-task', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ taskId: taskId })
        });

        const data = await response.json();
        
        if (data.success) {
            const taskItem = button.closest('.task-item');
            const taskText = taskItem.querySelector('p');
            
            taskItem.classList.add('completed');
            button.classList.add('completed');
            taskText.style.textDecoration = 'line-through';
            button.innerHTML = '✓';
            
            setTimeout(() => {
                alert(`🎉 Great job! You earned $${data.earnedMoney} and ${data.earnedStars} stars!`);
                location.reload(); // Refresh to show updated balance and stars
            }, 300);
        } else {
            alert('Error: ' + (data.error || 'Failed to complete task'));
        }
    } catch (error) {
        console.error('Error:', error);
        alert('Failed to complete task. Please try again.');
    }
}

// Chatbot Functions
function toggleChatbot() {
    const chatbot = document.getElementById('chatbot');
    chatbot.classList.toggle('open');
}

function handleChatKeypress(event) {
    if (event.key === 'Enter') {
        sendMessage();
    }
}

function sendMessage() {
    const input = document.getElementById('chatInput');
    const message = input.value.trim();
    
    if (message === '') return;
    
    // Add user message
    addMessage(message, 'user');
    input.value = '';
    
    // Get bot response
    setTimeout(() => {
        const response = getBotResponse(message);
        addMessage(response, 'bot');
    }, 1000);
}

function addMessage(text, type) {
    const messagesContainer = document.getElementById('chatMessages');
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    
    const bubbleDiv = document.createElement('div');
    bubbleDiv.className = 'message-bubble';
    bubbleDiv.textContent = text;
    
    messageDiv.appendChild(bubbleDiv);
    messagesContainer.appendChild(messageDiv);
    
    // Scroll to bottom
    messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function getBotResponse(input) {
    const lowerInput = input.toLowerCase();
    
    if (lowerInput.includes('save') || lowerInput.includes('saving')) {
        return "Great question about saving! 💰 Here's a tip: Try to save a little bit every day, even if it's just a few coins. Small amounts add up to BIG savings! Want to set a savings goal?";
    } else if (lowerInput.includes('invest') || lowerInput.includes('investment')) {
        return "Investing is like planting a money tree! 🌳 When you invest, your money grows over time. Check out the Investment Wallet to see how it works!";
    } else if (lowerInput.includes('goal')) {
        return "Setting goals is awesome! 🎯 Think about something you really want, then save a little bit each week. Before you know it, you'll have enough to get it!";
    } else if (lowerInput.includes('task') || lowerInput.includes('chore')) {
        return "Tasks are a great way to earn money! ✅ Complete your chores and homework to earn coins and stars. The more you do, the more you earn!";
    } else if (lowerInput.includes('spend') || lowerInput.includes('buy')) {
        return "Smart spending is important! 🛒 Before buying something, ask yourself: Do I really need this? Can I wait? Is there a better deal? These questions help you spend wisely!";
    } else if (lowerInput.includes('help') || lowerInput.includes('what can you')) {
        return "I'm here to help! 🤗 You can ask me about:\n• Saving money 💰\n• Investing 📈\n• Setting goals 🎯\n• Earning money 💵\n• Smart spending 🛒\nWhat would you like to know?";
    } else if (lowerInput.includes('game') || lowerInput.includes('level')) {
        return "Love the game feature! 🎮 Complete levels to earn coins and unlock achievements. Keep playing to become a Money Master!";
    } else if (lowerInput.includes('hi') || lowerInput.includes('hello') || lowerInput.includes('hey')) {
        return "Hi! 😊 How can I help you with your money today?";
    } else if (lowerInput.includes('thank')) {
        return "You're welcome! 🌟 Keep up the great work with your money!";
    }
    
    return "That's a great question! 🤔 I'm still learning, but I know a lot about saving, investing, and managing money. Try asking me about those topics!";
}

// Investment Options Selection
function selectInvestment(element) {
    // Remove selected class from all options
    document.querySelectorAll('.investment-option').forEach(option => {
        option.classList.remove('selected');
    });
    
    // Add selected class to clicked option
    element.classList.add('selected');
}

// Add Money to Balance
async function addMoney() {
    const amount = prompt('How much money do you want to add?');
    if (amount && !isNaN(amount) && amount > 0) {
        try {
            const response = await fetch('/dashboard/api/add-money', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    amount: parseFloat(amount),
                    description: 'Added from KidBank'
                })
            });

            const data = await response.json();
            
            if (data.requiresInteraction) {
                alert('Waiting for parent approval! You will be redirected.');
                window.location.href = data.interactUrl;
            } else if (data.success) {
                alert('💰 ' + data.message);
                location.reload(); // Refresh to show updated balance
            } else {
                alert('Error: ' + (data.error || 'Failed to add money'));
            }
        } catch (error) {
            console.error('Error:', error);
            alert('Failed to add money. Please try again.');
        }
    }
}

// Send Money
async function sendMoney() {
    const amount = prompt('How much money do you want to send?');
    const toUserId = prompt('Enter the recipient\'s user ID:');
    
    if (amount && !isNaN(amount) && amount > 0 && toUserId) {
        try {
            const response = await fetch('/dashboard/api/send-money', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    to_user_id: toUserId,
                    amount: parseFloat(amount),
                    description: 'Sent from KidBank'
                })
            });

            const data = await response.json();
            
            if (data.requiresInteraction) {
                alert('Waiting for parent approval! You will be redirected.');
                window.location.href = data.interactUrl;
            } else if (data.success) {
                alert('💸 ' + data.message);
                location.reload(); // Refresh to show updated balance
            } else {
                alert('Error: ' + (data.error || 'Failed to send money'));
            }
        } catch (error) {
            console.error('Error:', error);
            alert('Failed to send money. Please try again.');
        }
    }
}

// Add New Goal
function addNewGoal() {
    const goalName = prompt('What do you want to save for?');
    if (goalName) {
        const targetAmount = prompt('How much money do you need?');
        if (targetAmount && !isNaN(targetAmount) && targetAmount > 0) {
            alert(`🎯 Awesome! Your new goal "${goalName}" for $${targetAmount} has been added!`);
            // Here you would add the goal to the list in a real app
        }
    }
}

// Initialize App
document.addEventListener('DOMContentLoaded', function() {
    console.log('KidBank app loaded! 🌟');
    
    // You can add any initialization code here
    // For example, load saved data from localStorage
    
    // Add click handlers to investment options
    document.querySelectorAll('.investment-option').forEach(option => {
        option.addEventListener('click', function() {
            selectInvestment(this);
        });
    });
    
    console.log('All event listeners initialized!');
});

// Export functions if using modules (optional)
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        switchTab,
        completeTask,
        toggleChatbot,
        sendMessage,
        addMoney,
        sendMoney,
        addNewGoal
    };
}
