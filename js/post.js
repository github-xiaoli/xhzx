let postEditorMode = "new"; // new 或 edit
let editingPostId = null;

document.addEventListener("DOMContentLoaded", () => {
    loadPostList();
    document.getElementById("btn-new-post").addEventListener("click", showNewPostEditor);
    document.getElementById("btn-publish").addEventListener("click", publishPost);
});

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
        if (posts.length === 0) {
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

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

async function viewPost(id) {
    const modal = document.createElement("div");
    modal.className = "preview-modal";
    modal.innerHTML = `
        <div class="preview-backdrop"></div>
        <div class="preview-content" style="max-width:800px;">
            <span class="preview-close">&times;</span>
            <div id="post-view-content">加载中...</div>
        </div>`;
    document.body.appendChild(modal);
    modal.querySelector(".preview-close").onclick = () => modal.remove();
    modal.querySelector(".preview-backdrop").onclick = () => modal.remove();

    try {
        const data = await githubGet(`posts/${id}.html`);
        if (!data) throw new Error("帖子不存在");
        const html = decodeBase64Content(data.content);
        document.getElementById("post-view-content").innerHTML = html;
    } catch (err) {
        document.getElementById("post-view-content").innerHTML = `<p class="error">加载失败: ${err.message}</p>`;
    }
}

function showNewPostEditor() {
    if (!getToken()) {
        alert("请先登录");
        window.location.href = "login.html";
        return;
    }
    postEditorMode = "new";
    document.getElementById("post-title").value = "";
    document.getElementById("rich-editor").innerHTML = "";
    document.getElementById("editor-section").style.display = "block";
    document.getElementById("btn-publish").textContent = "发布";
}

async function editPost(id) {
    if (!getToken()) { alert("请先登录"); return; }
    try {
        const data = await githubGet(`posts/${id}.html`);
        if (!data) throw new Error("帖子不存在");
        const content = decodeBase64Content(data.content);
        // 同时获取列表数据得到标题
        const listData = await githubGet("posts/list.json");
        const posts = listData ? JSON.parse(decodeBase64Content(listData.content)) : [];
        const postMeta = posts.find(p => p.id === id);
        document.getElementById("post-title").value = postMeta ? postMeta.title : "";
        document.getElementById("rich-editor").innerHTML = content;
        postEditorMode = "edit";
        editingPostId = id;
        document.getElementById("editor-section").style.display = "block";
        document.getElementById("btn-publish").textContent = "保存修改";
    } catch (err) {
        alert("编辑失败: " + err.message);
    }
}

async function deletePost(id) {
    if (!confirm("确定删除该帖子吗？")) return;
    const token = getToken();
    try {
        await githubDelete(`posts/${id}.html`, (await githubGet(`posts/${id}.html`)).sha, token);
        // 更新列表
        const listData = await githubGet("posts/list.json");
        if (listData) {
            let posts = JSON.parse(decodeBase64Content(listData.content));
            posts = posts.filter(p => p.id !== id);
            const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(posts, null, 2))));
            await githubPut("posts/list.json", b64, `Delete post ${id}`, token, listData.sha);
        }
        await loadPostList();
    } catch (err) {
        alert("删除失败: " + err.message);
    }
}

async function publishPost() {
    const token = getToken();
    if (!token) { alert("未登录"); return; }
    const title = document.getElementById("post-title").value.trim();
    const content = document.getElementById("rich-editor").innerHTML.trim();
    if (!title || !content) { alert("标题和内容不能为空"); return; }

    const author = getAdminId();
    const now = new Date();
    const id = generateTimestamp() + "_" + Math.random().toString(36).substr(2, 5);

    try {
        // 1. 保存 HTML 文件
        const htmlB64 = btoa(unescape(encodeURIComponent(content)));
        if (postEditorMode === "edit") {
            const existing = await githubGet(`posts/${editingPostId}.html`);
            await githubPut(`posts/${editingPostId}.html`, htmlB64, `Update post ${editingPostId}`, token, existing ? existing.sha : null);
        } else {
            await githubPut(`posts/${id}.html`, htmlB64, `Create post ${id}`, token);
        }

        // 2. 更新 list.json
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
            posts.push({ id, title, author, timestamp: now.toISOString(), attachments: [] });
        }
        const listB64 = btoa(unescape(encodeURIComponent(JSON.stringify(posts, null, 2))));
        await githubPut("posts/list.json", listB64, "Update post list", token, listSha);

        document.getElementById("editor-section").style.display = "none";
        await loadPostList();
    } catch (err) {
        alert("发布失败: " + err.message);
    }
}

// 富文本工具栏
document.addEventListener("click", function(e) {
    if (e.target.classList.contains("tool-btn")) {
        e.preventDefault();
        const command = e.target.dataset.command;
        if (command === "createLink") {
            const url = prompt("输入链接地址：", "https://");
            if (url) document.execCommand(command, false, url);
        } else if (command === "insertImage") {
            // 简单起见，跳转附件上传（可后续扩展），这里直接插入示范
            const url = prompt("输入图片链接：", "https://");
            if (url) document.execCommand(command, false, url);
        } else {
            document.execCommand(command, false, null);
        }
    }
});