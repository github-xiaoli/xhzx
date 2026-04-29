let postEditorMode = "new";   // "new" 或 "edit"
let editingPostId = null;

document.addEventListener("DOMContentLoaded", () => {
    // 注册按钮事件
    document.getElementById("btn-new-post").addEventListener("click", showNewPostEditor);
    document.getElementById("btn-publish").addEventListener("click", publishPost);
    document.getElementById("btn-preview").addEventListener("click", togglePreview);
    document.getElementById("btn-close-preview").addEventListener("click", hidePreview);
    document.getElementById("btn-cancel-editor").addEventListener("click", cancelEditor);

    loadPostList();
});

// --- 帖子列表渲染 ---
async function loadPostList() {
    const listEl = document.getElementById("post-list");
    listEl.innerHTML = "<p>加载中…</p>";
    try {
        const data = await githubGet("posts/list.json");
        if (!data) {
            listEl.innerHTML = "<p>暂无帖子</p>";
            return;
        }
        const posts = JSON.parse(decodeBase64Content(data.content));
        if (!Array.isArray(posts) || posts.length === 0) {
            listEl.innerHTML = "<p>暂无帖子</p>";
            return;
        }
        posts.sort((a, b) => b.timestamp - a.timestamp);
        listEl.innerHTML = posts.map(p => `
            <div class="post-item">
                <div>
                    <span class="post-title" onclick="viewPost('${p.id}')">${escapeHtml(p.title)}</span>
                    <div class="post-meta">作者：${escapeHtml(p.author)} &nbsp;|&nbsp; ${new Date(p.timestamp).toLocaleString()}</div>
                </div>
                <div class="post-actions">
                    <button onclick="editPost('${p.id}')">✏️ 编辑</button>
                    <button class="delete-btn" onclick="deletePost('${p.id}')">🗑 删除</button>
                </div>
            </div>
        `).join('');
    } catch (err) {
        listEl.innerHTML = `<p class="error">加载失败: ${err.message}</p>`;
    }
}

// 基本 HTML 转义（防止标题/作者破坏页面，但帖子内容不转义）
function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

// 查看帖子（显示 iframe，可执行脚本）
async function viewPost(id) {
    const modal = document.createElement("div");
    modal.className = "preview-modal";
    modal.innerHTML = `
        <div class="preview-backdrop"></div>
        <div class="preview-content" style="width:95%; height:85%;">
            <span class="preview-close">&times;</span>
            <iframe id="post-view-iframe" style="width:100%; height:100%; border:none;" sandbox="allow-scripts allow-same-origin"></iframe>
        </div>`;
    document.body.appendChild(modal);

    const closeModal = () => modal.remove();
    modal.querySelector(".preview-close").onclick = closeModal;
    modal.querySelector(".preview-backdrop").onclick = closeModal;

    try {
        const data = await githubGet(`posts/${id}.html`);
        if (!data) throw new Error("帖子不存在");
        const htmlContent = decodeBase64Content(data.content);
        const iframe = document.getElementById("post-view-iframe");
        iframe.srcdoc = htmlContent;
    } catch (err) {
        document.getElementById("post-view-iframe").srcdoc = `<p style="color:red;">加载失败: ${err.message}</p>`;
    }
}

// --- 编辑器功能 ---
function showNewPostEditor() {
    if (!getToken()) {
        alert("请先登录");
        window.location.href = "login.html";
        return;
    }
    postEditorMode = "new";
    document.getElementById("post-title").value = "";
    document.getElementById("post-code").value = "";
    document.getElementById("editor-title").textContent = "发布新帖";
    document.getElementById("btn-publish").textContent = "发布";
    document.getElementById("editor-section").style.display = "block";
    hidePreview();
}

async function editPost(id) {
    if (!getToken()) { alert("请先登录"); return; }
    try {
        // 读取帖子内容
        const data = await githubGet(`posts/${id}.html`);
        if (!data) throw new Error("帖子不存在");
        const htmlContent = decodeBase64Content(data.content);

        // 读取标题元数据
        const listData = await githubGet("posts/list.json");
        const posts = listData ? JSON.parse(decodeBase64Content(listData.content)) : [];
        const meta = posts.find(p => p.id === id);

        document.getElementById("post-title").value = meta ? meta.title : "";
        document.getElementById("post-code").value = htmlContent;
        postEditorMode = "edit";
        editingPostId = id;
        document.getElementById("editor-title").textContent = "编辑帖子";
        document.getElementById("btn-publish").textContent = "保存修改";
        document.getElementById("editor-section").style.display = "block";
        hidePreview();
    } catch (err) {
        alert("编辑失败: " + err.message);
    }
}

function cancelEditor() {
    document.getElementById("editor-section").style.display = "none";
    hidePreview();
}

// --- 预览功能 ---
function togglePreview() {
    const previewBox = document.getElementById("preview-box");
    const code = document.getElementById("post-code").value;
    if (previewBox.style.display === "block") {
        hidePreview();
    } else {
        previewBox.style.display = "block";
        const iframe = document.getElementById("preview-iframe");
        iframe.srcdoc = code || "<p>无内容</p>";
    }
}

function hidePreview() {
    const previewBox = document.getElementById("preview-box");
    previewBox.style.display = "none";
    const iframe = document.getElementById("preview-iframe");
    iframe.srcdoc = "";  // 清空
}

// --- 发布/保存 ---
async function publishPost() {
    const token = getToken();
    if (!token) { alert("未登录"); return; }

    const title = document.getElementById("post-title").value.trim();
    const code = document.getElementById("post-code").value.trim();
    if (!title || !code) { alert("标题和内容不能为空"); return; }

    const author = getAdminId();
    const now = new Date();
    const id = generateTimestamp() + "_" + Math.random().toString(36).substr(2, 5);

    try {
        // 1. 上传 HTML 文件
        const htmlB64 = btoa(unescape(encodeURIComponent(code)));
        if (postEditorMode === "edit") {
            const existing = await githubGet(`posts/${editingPostId}.html`);
            await githubPut(`posts/${editingPostId}.html`, htmlB64, `Update post ${editingPostId}`, token, existing ? existing.sha : null);
        } else {
            await githubPut(`posts/${id}.html`, htmlB64, `Create post ${id}`, token);
        }

        // 2. 更新 list.json 索引
        const listData = await githubGet("posts/list.json");
        let posts = [];
        let listSha = null;
        if (listData) {
            posts = JSON.parse(decodeBase64Content(listData.content));
            listSha = listData.sha;
        }

        if (postEditorMode === "edit") {
            const idx = posts.findIndex(p => p.id === editingPostId);
            if (idx >= 0) {
                posts[idx].title = title;
                posts[idx].timestamp = now.toISOString();
                posts[idx].author = author;
            }
        } else {
            posts.push({
                id,
                title,
                author,
                timestamp: now.toISOString(),
                attachments: []
            });
        }

        const listB64 = btoa(unescape(encodeURIComponent(JSON.stringify(posts, null, 2))));
        await githubPut("posts/list.json", listB64, "Update post list", token, listSha);

        // 3. 收尾
        cancelEditor();
        await loadPostList();
    } catch (err) {
        alert("发布失败: " + err.message);
    }
}

// --- 删除帖子 ---
async function deletePost(id) {
    if (!confirm("确定删除该帖子吗？")) return;
    const token = getToken();
    try {
        const htmlData = await githubGet(`posts/${id}.html`);
        if (htmlData) await githubDelete(`posts/${id}.html`, htmlData.sha, token);
        // 更新索引
        const listData = await githubGet("posts/list.json");
        if (listData) {
            let posts = JSON.parse(decodeBase64Content(listData.content));
            posts = posts.filter(p => p.id !== id);
            const listB64 = btoa(unescape(encodeURIComponent(JSON.stringify(posts, null, 2))));
            await githubPut("posts/list.json", listB64, `Delete post ${id}`, token, listData.sha);
        }
        await loadPostList();
    } catch (err) {
        alert("删除失败: " + err.message);
    }
}