const addClientBtn = document.getElementById("add-client-btn");
const btnSpinner = document.getElementById("btn-spinner");
const btnText = document.getElementById("btn-text");

const SendMsgBtn = document.getElementById("reply-client-btn");
const qrCodesContainer = document.getElementById("qr-codes-container");
// const loadingSpinner = document.getElementById('loading-spinner');
const conversationsTableBody = document.getElementById(
  "conversations-table-body"
);
const conversationsTableDetailBody = document.getElementById(
  "conversations-table-detail-body"
);
const messagesContainer = document.getElementById("messages-container");
const ClinetModal = document.getElementById("ClinetModal");
const chatTitleDiv = document.getElementById("chat-title");
const contactAvatarDiv = document.getElementById("contact-avatar");
const replyMessageInput = document.getElementById("reply-message");
const chatSelectionModal = new bootstrap.Modal(
  document.getElementById("chatSelectionModal"),
  {}
);

var getQrCodeInterval = null;
var fetchConversationsInterval = null;
var currentConversationId = null;
var conversationArr = [];
let allMessagesArr = []; // Store all messages globally
// Add these state variables at the top of your script.js
let selectedMessageAction = null; // 'reply' or 'forward'

// Initialize Socket.IO
const socket = io();

async function initClients() {
  try {
    const response = await fetch(`/initializeClients`, { method: "POST" });
    if (!response.ok) {
      throw new Error("Failed to add client");
    }
  } catch (error) {
    console.error("Error adding client or fetching QR code:", error);
    return null;
  }
}

async function initClient(isInit) {
  try {
    const clientName = document.getElementById("client-name").value;

    // Basic validation
    if (!clientName) {
      qrCodesContainer.innerHTML = `
                    <div class="alert alert-danger" role="alert">
                        <i class="bi bi-exclamation-triangle-fill me-2"></i>
                        Please enter a client name
                    </div>
                `;
      return null;
    }

    if (clientName.includes(" ")) {
      qrCodesContainer.innerHTML = `
            <div class="alert alert-danger" role="alert">
                <i class="bi bi-exclamation-triangle-fill me-2"></i>
                Client name cannot contain spaces
            </div>
        `;
      return null;
    }

    addClientBtn.disabled = true;
    const response = await fetch(`/add-client/${clientName}`, {
      method: "POST",
      body: JSON.stringify({ isInit: isInit }),
    });
    if (!response.ok) {
      throw new Error("Failed to add client");
    }
    const data = await response.json();
    const clientId = data.clientId;
    if (data.status == "CONNECTED" && isInit) {
      initClient(true);
    }
    return clientId;
    // Fetch and display the QR code
  } catch (error) {
    console.error("Error adding client or fetching QR code:", error);
    qrCodesContainer.innerHTML = `
            <div class="alert alert-danger" role="alert">
                <i class="bi bi-exclamation-triangle-fill me-2"></i>
                Failed to add client. Please try again.
            </div>
        `;
    addClientBtn.disabled = false;
    return null;
  }
}

ClinetModal.addEventListener("hidden.bs.modal", function () {
  // put your default event here
  qrCodesContainer.innerHTML = "";
  clearInterval(getQrCodeInterval);
});

// Function to add a new client
addClientBtn.addEventListener("click", async () => {
  try {
    // Show loading state
    btnSpinner.classList.remove("d-none");
    btnText.textContent = "Generating QR Code...";
    addClientBtn.disabled = true;

    var clientId = await initClient(false);
    if (clientId != null) {
      getQrCodeInterval = setInterval(() => getQrCode(clientId), 5000);
    }
    // Fetch and display the QR code
  } catch (error) {
    console.error("Error adding client or fetching QR code:", error);
  }
});

// Function to fetch and display conversations
async function showConversationDetails(convId) {
  try {
    if (convId === undefined || convId === "") {
      return;
    }

    const response = await fetch(`/conversation/${convId}`);
    if (!response.ok) {
      throw new Error("Failed to fetch conversations");
    }
    const res = await response.json();
    if (res.conversations.length > 0) {
      conversationArr = res.conversations;
      currentConversationId = convId;
      drawConverstion();
    } else {
      conversationsTableDetailBody.innerHTML =
        '<tr><td colspan="7" class="text-center">No conversations yet.</td></tr>';
    }
  } catch (error) {
    console.error("Error fetching conversations:", error);
    clearInterval(fetchConversationsInterval);
    conversationsTableDetailBody.innerHTML =
      '<tr><td colspan="7" class="text-center">Failed to load conversations.</td></tr>';
  }
}

function drawConverstion() {
  messagesContainer.innerHTML =
    conversationArr.length === 0
      ? "<div class='alert alert-info' role='alert'>No conversations yet.</div>"
      : conversationArr
          .map((conv) => {
            let contentHtml;
            if (conv.content.type === "image") {
              contentHtml = `
                        <div class="media-container">
                            <img src="${conv.content.url}" class="img-thumbnail" alt="Image">
                            <p>${conv.content.text}</p>
                        </div>
                    `;
            } else if (conv.content.type === "audio") {
              contentHtml = `
                        <div class="media-container">
                            <audio controls>
                                <source src="${conv.content.url}" type="audio/mpeg">
                                <p>${conv.content.text}</p>
                                Your browser does not support the audio element.
                            </audio>
                        </div>
                    `;
            } else if (conv.content.type === "application") {
              contentHtml = `
                        <div class="media-container">
                            <a href="${conv.content.url}" target="_blank">
                                Download ${conv.content.filename || "File"}
                            </a>
                            <p>${conv.content.text}</p>
                        </div>
                    `;
            } else
              contentHtml = `<p>${conv.content.text.replace(
                /\n/g,
                "<br>"
              )}</p>`;
            // Check for quoted message in the structure that your backend provides
            const quotedMessageHtml = conv.hasQuotedMsg
              ? `
                    <div class="reply-context">
                        <div class="reply-bar"></div>
                        <div class="replied-message">
                            <strong>${conv.quotedMessage.sender}</strong>
                            <p>${
                              conv.quotedMessage.content.text || "Media message"
                            }</p>
                        </div>
                    </div>
                `
              : "";
            contactAvatarDiv.innerHTML =
              conv.type == "received"
                ? conv.senderName && conv.senderName.length > 0
                  ? conv.senderName[0]
                  : "R"
                : conv.receiverName && conv.receiverName.length > 0
                ? conv.receiverName[0]
                : "S";
            chatTitleDiv.innerHTML = `<h6 class="mb-0">${
              conv.isGroup
                ? conv.receiverName
                : conv.type == "received"
                ? conv.senderName
                : conv.receiverName
            }</h6>`;

            const senderColor =
              conv.type === "received" && conv.senderName
                ? stringToColor(conv.senderName)
                : "#2196f3";

            return `
                    <div class="message ${
                      conv.type == "received" ? "received" : "sent"
                    }">
                        <div class="message-content">
                            ${quotedMessageHtml}
                            <div class="message-header">
                                <strong style="color:${
                                  conv.type == "received"
                                    ? senderColor
                                    : "#000000"
                                }">${conv.senderName}</strong>
                                <div class="message-actions">
                                    <button class="btn btn-sm action-btn" onclick="selectMessage('${
                                      conv.id
                                    }', 'reply')" title="Reply">
                                        <i class="bi bi-reply-fill"></i>
                                    </button>
                                    <button class="btn btn-sm action-btn" onclick="selectMessage('${
                                      conv.id
                                    }', 'forward')" title="Forward">
                                        <i class="bi bi-forward-fill"></i>
                                    </button>
                                </div>
                            </div>
                            ${contentHtml}
                            <div class="message-footer">
                                <span class="message-time">${new Date(
                                  conv.timestamp
                                ).toLocaleString()}</span>
                                <span class="message-status">
                                    ${
                                      conv.type === "sent"
                                        ? `<i class="fs-6 ms-2 bi bi-check2${
                                            conv.ack >= 2 ? "-all" : ""
                                          } ${
                                            conv.ack === 3 ? "text-primary" : ""
                                          }"></i>`
                                        : ""
                                    }
                                </span>
                            </div>
                        </div>
                    </div>
                `;
          })
          .join("");

  // Scroll to bottom after loading messages
  scrollToBottom();
  // If there's a selected message, scroll to it
  if (selectedMessage) {
    scrollToMessage(selectedMessage.id);
  }
}

replyMessageInput.addEventListener("keydown", async (e) => {
  if (e.key === "Enter") {
    await SendMsgBtn.click();
    e.preventDefault();
  }
});

SendMsgBtn.addEventListener("click", async () => {
  try {
    const message = replyMessageInput.value.trim();

    if (selectedMessage && selectedMessageAction === "reply" && message) {
      await replyToMessage();
      // Clear the input and reply preview after sending
      replyMessageInput.value = "";
      cancelReply();
    } else if (message) {
      try {
        const response = await fetch(`/replyconversation`, {
          method: "POST",
          body: JSON.stringify({
            clientId: conversationArr[0].clientId,
            message,
            chatid: conversationArr[0].chatid,
          }),
        });
        if (!response.ok) {
          throw new Error("Failed to send reply");
        }

        replyMessageInput.value = ""; // Clear the input
      } catch (error) {
        console.error("Error sending reply:", error);
        alert("Failed to send reply. Check the console for details.");
      }
    }
  } catch (error) {
    console.log(error);
  }
});
// First request notification permission
function requestNotificationPermission() {
  if (!("Notification" in window)) {
    console.log("This browser does not support desktop notification");
    return;
  }
  if (
    Notification.permission !== "granted" &&
    Notification.permission !== "denied"
  ) {
    Notification.requestPermission().then(function (permission) {
      if (permission === "granted") {
        console.log("Notification permission granted!");
      }
    });
  }
}

// Function to show Chrome notification
function showNotification(data) {
  // Check if browser supports notifications
  if (!("Notification" in window)) {
    console.log("This browser does not support desktop notification");
    return;
  }

  // Check if we have permission
  if (Notification.permission === "granted") {
    // Create notification options
    const options = {
      body: data.content.text || "New message received",
      icon: "/notification-icon.png", // Add your notification icon path
      badge: "/badge-icon.png", // Add your badge icon path
      timestamp: new Date(data.timestamp).getTime(),
      tag: data.id, // Use message ID as tag to prevent duplicate notifications
      requireInteraction: true, // Notification will remain until user interacts
      silent: false, // Will play notification sound
      vibrate: [200, 100, 200], // Vibration pattern for mobile devices
    };

    // Create and show notification
    const notification = new Notification(`${data.senderName}`, options);

    // Add click handler
    notification.onclick = function (event) {
      event.preventDefault();
      // Focus on window and show conversation
      window.focus();
      showConversationDetails(data.conversationId);
      this.close();
    };

    // Optional: Auto close after 5 seconds
    setTimeout(() => {
      notification.close();
    }, 5000);

    // Play notification sound
    const audio = new Audio("/notification.mp3");
    audio.play().catch((e) => console.log("Audio playback failed:", e));
  } else if (Notification.permission !== "denied") {
    // Request permission and show notification if granted
    Notification.requestPermission().then(function (permission) {
      if (permission === "granted") {
        showNotification(data);
      }
    });
  }
}
// Helper function to format relative time
function getRelativeTime(date) {
  const now = new Date();
  const diffInSeconds = Math.floor((now - date) / 1000);

  if (diffInSeconds < 60) return "Just now";
  if (diffInSeconds < 3600) return `${Math.floor(diffInSeconds / 60)}m ago`;
  if (diffInSeconds < 86400) return `${Math.floor(diffInSeconds / 3600)}h ago`;
  return date.toLocaleDateString();
}
// // Add socket event listener
// socket.on('new-message', (data) => {
//     showToast(data);
// });

async function fetchConversations() {
  try {
    const response = await fetch("/conversations");
    if (!response.ok) {
      throw new Error("Failed to fetch conversations");
    }
    const res = await response.json();

    if (res == null) {
      return;
    }
    console.log("res", res);
    allMessagesArr = res.conversations;
    drowAllConversation();
  } catch (error) {
    console.error("Error fetching conversations:", error);
    clearInterval(fetchConversationsInterval);
    conversationsTableBody.innerHTML =
      '<tr><td colspan="7" class="text-center">Failed to load conversations.</td></tr>';
  }
}

async function getQrCode(clientId) {
  try {
    // Fetch and display the QR code
    const qrCodeResponse = await fetch(`/qr-code/${clientId}`);
    if (!qrCodeResponse.ok) {
      if (qrCodeResponse.status === 404) {
        qrCodesContainer.innerHTML = `
                    <div class="alert alert-success" role="alert">
                        <i class="bi bi-check-circle-fill me-2"></i>
                        Client connected successfully!
                    </div>
                `;
        clearInterval(getQrCodeInterval);

        // Reset button state
        btnSpinner.classList.add("d-none");
        btnText.textContent = "Add New WhatsApp Client";
        addClientBtn.disabled = false;
        return;
      }
      throw new Error("Failed to fetch QR code");
    }
    const qrCodeData = await qrCodeResponse.json();
    if (qrCodeData.qrCode) {
      qrCodesContainer.innerHTML = `
                <div class="qr-code-wrapper">
                    <p class="mb-3">Scan this QR code with WhatsApp on your phone</p>
                    <img src="${qrCodeData.qrCode}" alt="WhatsApp QR Code" class="img-fluid">
                    <p class="mt-3 text-muted small">QR Code for client: ${clientId}</p>
                </div>
    `;
    } else {
      console.error("No QR code found in response");
    }

    // Reset button state but keep disabled while QR code is showing
    btnSpinner.classList.add("d-none");
    btnText.textContent = "QR Code Generated";

    // Initial fetch
    fetchConversations();
  } catch (error) {
    console.error("Error adding client or fetching QR code:", error);
    qrCodesContainer.innerHTML = `
            <div class="alert alert-danger" role="alert">
                <i class="bi bi-exclamation-triangle-fill me-2"></i>
                Failed to generate QR code. Please try again.
            </div>
        `;
    // Reset button state
    btnSpinner.classList.add("d-none");
    btnText.textContent = "Add New WhatsApp Client";
    addClientBtn.disabled = false;
  }
}

function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  let color = "#";
  for (let i = 0; i < 3; i++) {
    const value = (hash >> (i * 8)) & 0xff;
    color += ("00" + value.toString(16)).substr(-2);
  }
  return color;
}

// Dark mode toggle
document
  .getElementById("darkModeToggle")
  .addEventListener("click", function () {
    document.body.classList.toggle("dark-mode");
    const icon = this.querySelector("i");
    if (document.body.classList.contains("dark-mode")) {
      icon.classList.remove("bi-moon-fill");
      icon.classList.add("bi-sun-fill");
    } else {
      icon.classList.remove("bi-sun-fill");
      icon.classList.add("bi-moon-fill");
    }
  });

let selectedMessage = null;
// Function to handle message selection
async function selectMessage(messageId, action) {
  selectedMessage = conversationArr.find((msg) => msg.id === messageId);
  if (selectedMessage) {
    selectedMessageAction = action;

    // Remove previous selections
    document.querySelectorAll(".message").forEach((msg) => {
      msg.classList.remove("selected", "replying", "forwarding");
    });

    const messageElement = document.querySelector(
      `.message:has(button[onclick*="${messageId}"])`
    );
    messageElement.classList.add(
      "selected",
      action === "reply" ? "replying" : "forwarding"
    );

    // Show appropriate action in reply input
    const replyInput = document.getElementById("reply-message");
    if (action === "reply") {
      replyInput.placeholder = `Replying to ${selectedMessage.senderName}...`;
      document.getElementById("reply-indicator").innerHTML = `
                <div class="reply-preview">
                    <i class="bi bi-reply-fill"></i>
                    <span>Replying to ${selectedMessage.senderName}</span>
                    <button class="btn btn-sm" onclick="cancelReply()">
                        <i class="bi bi-x"></i>
                    </button>
                </div>
            `;
    } else {
      replyInput.placeholder = `Forward this message...`;
      // Fetch available chats
      const clientId = selectedMessage.clientId;
      const chats = await fetchAvailableChats(clientId);
      if (chats.length === 0) {
        alert("No chats available.");
        return;
      }
      // Display chats in the modal
      const chatList = document.getElementById("chat-list");
      chatList.innerHTML = chats
        .map(
          (chat) => `
                <li class="list-group-item chat-item" onclick="forwardToChat('${
                  chat.id._serialized
                }')">
                        <div class="d-flex justify-content-between align-items-center">
                            <span>${
                              chat.isGroup
                                ? `👥 ${chat.name}`
                                : `👤 ${chat.name || chat.id.user}`
                            }</span>
                            <small class="text-muted">${
                              chat.isGroup ? "Group" : "Contact"
                            }</small>
                        </div>
                    </li>
            `
        )
        .join("");

      // Show the modal
      chatSelectionModal.show();
    }

    document.getElementById("reply-indicator").style.display = "block";
  }
}

// Add function to cancel reply
function cancelReply() {
  document.querySelectorAll(".message").forEach((msg) => {
    msg.classList.remove("selected", "replying", "forwarding");
  });
  document.getElementById("reply-indicator").style.display = "none";
  document.getElementById("reply-message").placeholder = "Type a message";
  selectedMessage = null;
  selectedMessageAction = null;
}

async function forwardToChat(chatId) {
  try {
    const response = await fetch(`/forwardtochat`, {
      method: "POST",
      body: JSON.stringify({
        chatId: chatId,
        selectedMessage: selectedMessage,
      }),
    });

    if (!response.ok) {
      throw new Error("Failed to forward message");
    }

    const result = await response.json();
    if (result.success) {
      alert("Message forwarded successfully!");
      // Clear selection
      selectedMessage = null;
      document
        .querySelectorAll(".message")
        .forEach((msg) => msg.classList.remove("selected"));
      chatSelectionModal.hide();
    } else {
      throw new Error(result.error || "Failed to forward message");
    }
  } catch (error) {
    console.error("Error forwarding message:", error);
    return null;
  }
}

async function fetchAvailableChats(clientId) {
  try {
    const response = await fetch(`/availablechats/${clientId}`);
    if (!response.ok) {
      throw new Error("Failed to fetch conversations");
    }
    const data = await response.json();
    return data.chats;
  } catch (error) {
    console.error("Error fetching chats:", error);
    return [];
  }
}

async function replyToMessage() {
  const replyText = document.getElementById("reply-message").value.trim();
  if (!replyText) {
    alert("Please enter a reply message");
    return;
  }

  try {
    // Create a reply object that includes both the new message and the original message data
    const replyData = {
      clientId: selectedMessage.clientId,
      chatid: selectedMessage.chatid,
      replyText: replyText,
      id: selectedMessage.id,
      quotedMessage: {
        sender: selectedMessage.senderName,
        content: selectedMessage.content,
      },
    };

    const response = await fetch(`/replytomsg`, {
      method: "POST",
      body: JSON.stringify({ selectedMessage: replyData }),
    });

    if (!response.ok) {
      throw new Error("Failed to reply message");
    }

    const result = await response.json();
    if (result.success) {
      // Clear selection and input
      document.getElementById("reply-message").value = "";
      cancelReply();

      // Refresh the conversation to show the new reply
      setTimeout(() => showConversationDetails(conversationId), 1000);
    } else {
      throw new Error(result.error || "Failed to send reply");
    }
  } catch (error) {
    console.error("Error replying message:", error);
    return null;
  }
}
function drowAllConversation() {
  if (allMessagesArr.length > 0) {
    conversationsTableBody.innerHTML = allMessagesArr
      .sort(
        (a, b) =>
          new Date(b.timestamp || new Date()) -
          new Date(a.timestamp || new Date())
      )
      .map((conv) => {
        const chatTitle = conv.isGroup
          ? conv.receiverName
          : conv.type === "received"
          ? conv.senderName
          : conv.receiverName;
        return `
                <tr class="${conv.type}" onclick="showConversationDetails('${
          conv.conversationId
        }')">
                    <td class="w30px">${conv.clientId}</td>
                    <td class="w30px">${chatTitle}</td>
                    <td class="w50px text-truncate " style="max-width: 250px;">${
                      conv.content.type == "image"
                        ? "image"
                        : conv.content.type == "application"
                        ? "file"
                        : conv.content.type == "audio"
                        ? "audio"
                        : `${conv.content.text}`
                    }</td>
                    <td class="w30px"> <span class="badge badge-status status-${conv.status.toLowerCase()}">${
          conv.status
        }</span></td>
                    <td class="w30px">${new Date(
                      conv.timestamp
                    ).toLocaleString()}</td>
                </tr>
            `;
      })
      .join("");
  } else {
    conversationsTableBody.innerHTML =
      '<tr><td colspan="7" class="text-center">No conversations yet.</td></tr>';
  }
}

socket.on("clientDisconnected", ({ clientId, reason }) => {
  console.log("Client disconnected:", clientId, reason);
  if (conversationArr.length > 0 && conversationArr[0].clientId === clientId) {
    currentConversationId = null;
    conversationArr = [];
    drawConverstion();
  }

  allMessagesArr = allMessagesArr.filter((msg) => msg.clientId !== clientId);
  drowAllConversation();
});

// Listen for synced conversations
socket.on("conversationSynced", ({ clientId, conversationId, messages }) => {
  // Update allMessagesArr with the latest message from this conversation
  const latestMessage = messages[messages.length - 1];
  allMessagesArr = allMessagesArr.filter(
    (msg) => msg.conversationId !== conversationId
  );
  allMessagesArr.push(latestMessage);
  drowAllConversation();

  // If this is the current conversation, update it
  if (conversationId === currentConversationId) {
    conversationArr = messages;
    drawConverstion();
  }
});

socket.on("statusUpdated", ({ conversationId, status, ack }) => {
  if (conversationId === currentConversationId) {
    conversationArr = conversationArr.map((msg) => ({
      ...msg,
      status: msg.conversationId === conversationId ? status : msg.status,
      ack: msg.conversationId === conversationId ? ack : msg.ack,
    }));
    drawConverstion();
  }
  allMessagesArr = allMessagesArr.map((msg) => ({
    ...msg,
    status: msg.conversationId === conversationId ? status : msg.status,
  }));
  drowAllConversation();
});

socket.on("messageReceived", ({ conversationId, message }) => {
  // Update conversations if needed

  allMessagesArr = allMessagesArr.filter(
    (msg) => msg.conversationId !== conversationId
  );
  allMessagesArr.push(message);
  drowAllConversation();
  if (conversationId === currentConversationId) {
    conversationArr.push(message);
    drawConverstion();
  }
  // Show notification
  //showToast(message);
  showNotification(message);
});

socket.on("messageSent", ({ conversationId, message }) => {
  // Update conversations if needed
  if (conversationId === currentConversationId) {
    conversationArr.push(message);
    drawConverstion();
    //showConversationDetails(conversationId).then(() => scrollToBottom());
  }
  allMessagesArr = allMessagesArr.filter(
    (msg) => msg.conversationId !== conversationId
  );
  allMessagesArr.push(message);
  drowAllConversation();
});

socket.on("disconnect", () => {
  console.log("Disconnected from server");
});

// Function to scroll to bottom of messages container
function scrollToBottom() {
  const messagesContainer = document.getElementById("messages-container");
  messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

// Function to scroll to specific message
function scrollToMessage(messageId) {
  const messageElement = document.querySelector(
    `.message:has(button[onclick*="${messageId}"])`
  );
  if (messageElement) {
    messageElement.scrollIntoView({ behavior: "smooth", block: "center" });
    // Add a highlight effect
    messageElement.classList.add("highlight");
    setTimeout(() => messageElement.classList.remove("highlight"), 2000);
  }
}
setTimeout(() => {
  initClients();
  // Initial fetch
  fetchConversations();
});
