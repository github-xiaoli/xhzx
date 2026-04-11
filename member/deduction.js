// ==================== 配置 ====================
const REPO_OWNER = "github-xiaoli";
const REPO_NAME = "xhzx";
const BRANCH = "main";
const GITHUB_API = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}/contents`;
const COOKIE_NAME = "card_key";
const COOKIE_EXPIRE_DAYS = 30;

// Cookie 操作
function setCookie(name, value, days) {
    const expires = new Date();
    expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
    document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/`;
}
function getCookie(name) {
    const match = document.cookie.match(new RegExp('(^| )' + name + '=([^;]+)'));
    return match ? match[2] : null;
}

// 【关键修改】从静态网站获取卡密内容（即 GitHub Token）
async function getTokenFromCard(cardKey) {
    // 使用相对路径，自动适配当前协议（http/https）
    const url = `/key/${cardKey}`;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`卡密无效或不存在 (HTTP ${response.status}): ${cardKey}`);
    }
    const token = await response.text();
    if (!token.trim()) {
        throw new Error(`卡密文件为空: ${cardKey}`);
    }
    return token.trim();
}

// 验证卡密是否有效（能读取到非空内容即可）
async function verifyCardKey(cardKey) {
    try {
        const token = await getTokenFromCard(cardKey);
        return token.length > 0;
    } catch(e) {
        return false;
    }
}

// 初始化卡密（首次访问）
async function initCardKey() {
    let cardKey = getCookie(COOKIE_NAME);
    if (cardKey) {
        const valid = await verifyCardKey(cardKey);
        if (valid) return cardKey;
        else {
            document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
        }
    }
    let newKey = null;
    while (!newKey) {
        newKey = prompt("请输入卡密（API密钥）以进行扣分操作：");
        if (newKey === null) {
            alert("必须输入卡密才能使用扣分功能，但查询功能不受影响。");
            return null;
        }
        const valid = await verifyCardKey(newKey);
        if (valid) {
            setCookie(COOKIE_NAME, newKey, COOKIE_EXPIRE_DAYS);
            return newKey;
        } else {
            alert("卡密无效，请重新输入。");
            newKey = null;
        }
    }
    return null;
}

// 通用 GitHub API 请求（带 token）
async function githubRequest(method, url, token, body = null) {
    const options = {
        method,
        headers: {
            'Authorization': `token ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'Content-Type': 'application/json'
        }
    };
    if (body) options.body = JSON.stringify(body);
    const response = await fetch(url, options);
    if (!response.ok) {
        const err = await response.text();
        throw new Error(`GitHub API 错误 ${response.status}: ${err}`);
    }
    if (method === 'DELETE') return null;
    return await response.json();
}

// 获取文件内容（不需要 token，公开仓库）
async function getFileContent(path) {
    const url = `${GITHUB_API}/${path}?ref=${BRANCH}`;
    const res = await fetch(url);
    if (!res.ok) {
        if (res.status === 404) return null;
        throw new Error(`读取文件失败: ${path}`);
    }
    const data = await res.json();
    return data;
}

// 创建或更新文件（需要 token）
async function createOrUpdateFile(path, content, token, commitMsg) {
    let sha = null;
    try {
        const existing = await getFileContent(path);
        if (existing && existing.sha) sha = existing.sha;
    } catch(e) { /* 文件不存在 */ }
    const url = `${GITHUB_API}/${path}`;
    const body = {
        message: commitMsg,
        content: btoa(unescape(encodeURIComponent(content))),
        branch: BRANCH
    };
    if (sha) body.sha = sha;
    return await githubRequest('PUT', url, token, body);
}

// 确保目录存在（通过创建 .gitkeep 文件）
async function ensureDirectory(dirPath, token) {
    const keepPath = `${dirPath}/.gitkeep`;
    try {
        const existing = await getFileContent(keepPath);
        if (existing) return;
        await createOrUpdateFile(keepPath, "", token, `创建目录 ${dirPath}`);
    } catch(e) {
        console.warn(`无法确保目录 ${dirPath}:`, e);
    }
}

// 确保所有必要目录存在
async function ensureAllDirectories(token, studentId = null) {
    await ensureDirectory("scores", token);
    await ensureDirectory("deductions", token);
    if (studentId) {
        await ensureDirectory(`deductions/${studentId}`, token);
        await ensureDirectory(`deductions/${studentId}/attachments`, token);
    }
}

// 上传附件
async function uploadAttachment(studentId, timestamp, file, token) {
    const safeName = `${timestamp.replace(/:/g, '-').replace(/\./g, '-')}_${file.name}`;
    const path = `deductions/${studentId}/attachments/${safeName}`;
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = async function(e) {
            const base64 = e.target.result.split(',')[1];
            const url = `${GITHUB_API}/${path}`;
            const body = {
                message: `上传附件 ${safeName}`,
                content: base64,
                branch: BRANCH
            };
            try {
                await githubRequest('PUT', url, token, body);
                resolve(path);
            } catch(err) {
                reject(err);
            }
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

// 获取所有学生学号
async function getAllStudentIds() {
    const url = `${GITHUB_API}/member/member_info?ref=${BRANCH}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    return data.filter(item => item.type === 'dir').map(dir => dir.name);
}

// 获取学生当前分数
async function getStudentScore(studentId) {
    const path = `scores/${studentId}.json`;
    const file = await getFileContent(path);
    if (!file) return 0;
    try {
        const content = JSON.parse(atob(file.content));
        return content.score || 0;
    } catch(e) {
        return 0;
    }
}

// 获取学生的所有扣分记录文件列表
async function getStudentDeductionFiles(studentId) {
    const dirPath = `deductions/${studentId}`;
    const url = `${GITHUB_API}/${dirPath}?ref=${BRANCH}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data)) return [];
    return data.filter(item => item.type === 'file' && item.name.endsWith('.json')).map(f => f.name);
}

// 读取单个扣分记录
async function getDeductionRecord(studentId, filename) {
    const path = `deductions/${studentId}/${filename}`;
    const file = await getFileContent(path);
    if (!file) return null;
    try {
        return JSON.parse(atob(file.content));
    } catch(e) {
        return null;
    }
}

// 获取所有学生的完整数据（用户列表）
async function getAllStudentsData() {
    const studentIds = await getAllStudentIds();
    const results = [];
    for (const id of studentIds) {
        const score = await getStudentScore(id);
        results.push({ studentId: id, currentScore: score });
    }
    return results;
}

// 获取所有扣分记录（全局）
async function getAllDeductionRecords() {
    const studentIds = await getAllStudentIds();
    const allRecords = [];
    for (const id of studentIds) {
        const files = await getStudentDeductionFiles(id);
        for (const fname of files) {
            const rec = await getDeductionRecord(id, fname);
            if (rec) {
                allRecords.push({
                    studentId: id,
                    ...rec
                });
            }
        }
    }
    allRecords.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
    return allRecords;
}

// ========== 用户列表渲染 ==========
let allUsersData = [];
let currentUserPage = 1;
const userPageSize = 10;
let currentUserSort = "score_desc";

function renderUserList() {
    let sorted = [...allUsersData];
    if (currentUserSort === "score_desc") {
        sorted.sort((a,b) => b.currentScore - a.currentScore);
    } else {
        sorted.sort((a,b) => a.studentId.localeCompare(b.studentId));
    }
    const start = (currentUserPage-1)*userPageSize;
    const end = start + userPageSize;
    const pageData = sorted.slice(start, end);
    let html = `<table><thead><tr><th>学号</th><th>当前总分</th></thead><tbody>`;
    pageData.forEach(item => {
        html += `<tr><td>${item.studentId}</td><td>${item.currentScore}</td></tr>`;
    });
    html += `</tbody></table>`;
    document.getElementById('userListResult').innerHTML = html;
    
    const totalPages = Math.ceil(allUsersData.length / userPageSize);
    let paginationHtml = '';
    for (let i=1; i<=totalPages; i++) {
        paginationHtml += `<button class="${i===currentUserPage?'active':''}" onclick="goToUserPage(${i})">${i}</button>`;
    }
    document.getElementById('userListPagination').innerHTML = paginationHtml;
}

window.goToUserPage = function(page) {
    currentUserPage = page;
    renderUserList();
};

// ========== 全局扣分记录渲染 ==========
let allRecordsData = [];
let currentRecordPage = 1;
const recordPageSize = 10;

function renderAllRecords() {
    const start = (currentRecordPage-1)*recordPageSize;
    const end = start + recordPageSize;
    const pageRecords = allRecordsData.slice(start, end);
    if (pageRecords.length === 0) {
        document.getElementById('allRecordsResult').innerHTML = '<p>暂无扣分记录。</p>';
        document.getElementById('allRecordsPagination').innerHTML = '';
        return;
    }
    let html = `<table><thead><tr><th>学号</th><th>扣分分值</th><th>原因</th><th>时间</th><th>附件</th></thead><tbody>`;
    pageRecords.forEach(rec => {
        let attachHtml = '';
        if (rec.attachments && rec.attachments.length) {
            attachHtml = rec.attachments.map(p => `<a href="https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${p}" target="_blank">📎 ${p.split('/').pop()}</a>`).join('<br>');
        } else {
            attachHtml = '无';
        }
        html += `<tr>
                     <td>${rec.studentId}</td>
                     <td style="color:red;">${rec.points}</td>
                     <td>${rec.reason}</td>
                     <td>${new Date(rec.timestamp).toLocaleString()}</td>
                     <td>${attachHtml}</td>
                   </tr>`;
    });
    html += `</tbody> licensierad`;
    document.getElementById('allRecordsResult').innerHTML = html;
    
    const totalPages = Math.ceil(allRecordsData.length / recordPageSize);
    let paginationHtml = '';
    for (let i=1; i<=totalPages; i++) {
        paginationHtml += `<button class="${i===currentRecordPage?'active':''}" onclick="goToRecordPage(${i})">${i}</button>`;
    }
    document.getElementById('allRecordsPagination').innerHTML = paginationHtml;
}

window.goToRecordPage = function(page) {
    currentRecordPage = page;
    renderAllRecords();
};

// 刷新所有数据
async function refreshAllData() {
    allUsersData = await getAllStudentsData();
    currentUserPage = 1;
    renderUserList();
    allRecordsData = await getAllDeductionRecords();
    currentRecordPage = 1;
    renderAllRecords();
}

// 个人查询
document.getElementById('queryBtn').onclick = async () => {
    const studentId = document.getElementById('queryStudentId').value.trim();
    if (!studentId) {
        showAlert('personalResult', '请输入学号', 'error');
        return;
    }
    try {
        const score = await getStudentScore(studentId);
        const files = await getStudentDeductionFiles(studentId);
        const records = [];
        for (const fname of files) {
            const rec = await getDeductionRecord(studentId, fname);
            if (rec) records.push(rec);
        }
        records.sort((a,b) => new Date(b.timestamp) - new Date(a.timestamp));
        let html = `<h3>学号：${studentId}  当前总分：${score}</h3>`;
        if (records.length === 0) {
            html += `<p>暂无扣分记录。</p>`;
        } else {
            html += `<table><thead><tr><th>时间</th><th>扣分分值</th><th>原因</th><th>附件</th></thead><tbody>`;
            records.forEach(rec => {
                let attachHtml = '';
                if (rec.attachments && rec.attachments.length) {
                    attachHtml = rec.attachments.map(p => `<a href="https://raw.githubusercontent.com/${REPO_OWNER}/${REPO_NAME}/${BRANCH}/${p}" target="_blank">${p.split('/').pop()}</a>`).join('<br>');
                } else {
                    attachHtml = '无';
                }
                html += `<tr>
                             <td>${new Date(rec.timestamp).toLocaleString()}</td>
                             <td style="color:red;">${rec.points}</td>
                             <td>${rec.reason}</td>
                             <td>${attachHtml}</td>
                           </tr>`;
            });
            html += `</tbody></table>`;
        }
        document.getElementById('personalResult').innerHTML = html;
    } catch(e) {
        showAlert('personalResult', `查询失败: ${e.message}`, 'error');
    }
};

function showAlert(containerId, message, type) {
    const container = document.getElementById(containerId);
    if (!container) return;
    container.innerHTML = `<div class="alert alert-${type}">${message}</div>`;
    setTimeout(() => { container.innerHTML = ''; }, 5000);
}

// 扣分提交
document.getElementById('deductForm').onsubmit = async (e) => {
    e.preventDefault();
    const alertDiv = document.getElementById('deductAlert');
    alertDiv.style.display = 'none';
    
    let cardKey = getCookie(COOKIE_NAME);
    if (!cardKey) {
        showAlert('deductAlert', '未找到卡密，请刷新页面重新输入', 'error');
        return;
    }
    const valid = await verifyCardKey(cardKey);
    if (!valid) {
        showAlert('deductAlert', '卡密已失效，请刷新页面重新输入', 'error');
        document.cookie = `${COOKIE_NAME}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;`;
        return;
    }
    
    const studentId = document.getElementById('studentId').value.trim();
    const pointsInput = document.getElementById('points').value;
    const points = Math.abs(parseInt(pointsInput));
    const reason = document.getElementById('reason').value.trim();
    const files = document.getElementById('attachments').files;
    
    if (!studentId || !points || !reason) {
        showAlert('deductAlert', '请填写所有必填项', 'error');
        return;
    }
    
    const allIds = await getAllStudentIds();
    if (!allIds.includes(studentId)) {
        showAlert('deductAlert', `学号 ${studentId} 不存在于成员列表中`, 'error');
        return;
    }
    
    let token;
    try {
        token = await getTokenFromCard(cardKey);
    } catch(e) {
        showAlert('deductAlert', `获取Token失败: ${e.message}`, 'error');
        return;
    }
    
    try {
        await ensureAllDirectories(token, studentId);
    } catch(e) {
        showAlert('deductAlert', `创建必要目录失败: ${e.message}`, 'error');
        return;
    }
    
    const timestamp = new Date().toISOString();
    const attachmentPaths = [];
    try {
        for (let i=0; i<files.length; i++) {
            const path = await uploadAttachment(studentId, timestamp, files[i], token);
            attachmentPaths.push(path);
        }
    } catch(e) {
        showAlert('deductAlert', `附件上传失败: ${e.message}`, 'error');
        return;
    }
    
    const deductionRecord = {
        studentId: studentId,
        points: -points,
        reason: reason,
        timestamp: timestamp,
        attachments: attachmentPaths
    };
    const recordContent = JSON.stringify(deductionRecord, null, 2);
    const recordFilename = `${timestamp.replace(/:/g, '-').replace(/\./g, '-')}.json`;
    const recordPath = `deductions/${studentId}/${recordFilename}`;
    try {
        await createOrUpdateFile(recordPath, recordContent, token, `扣分记录 ${studentId} ${points}分`);
    } catch(e) {
        showAlert('deductAlert', `创建扣分记录失败: ${e.message}`, 'error');
        return;
    }
    
    const scorePath = `scores/${studentId}.json`;
    let currentScore = await getStudentScore(studentId);
    let newScore = currentScore - points;
    const scoreContent = JSON.stringify({ score: newScore }, null, 2);
    try {
        await createOrUpdateFile(scorePath, scoreContent, token, `更新 ${studentId} 分数: ${currentScore} -> ${newScore}`);
        showAlert('deductAlert', `扣分成功！学号 ${studentId} 扣 ${points} 分，当前总分 ${newScore}`, 'success');
        document.getElementById('points').value = '';
        document.getElementById('reason').value = '';
        document.getElementById('attachments').value = '';
        await refreshAllData();
        document.getElementById('personalResult').innerHTML = '';
    } catch(e) {
        showAlert('deductAlert', `更新分数文件失败: ${e.message}，但扣分记录已创建`, 'error');
    }
};

// 排序按钮
document.getElementById('sortByScoreBtn').onclick = () => {
    currentUserSort = "score_desc";
    currentUserPage = 1;
    renderUserList();
};
document.getElementById('sortByIdBtn').onclick = () => {
    currentUserSort = "id_asc";
    currentUserPage = 1;
    renderUserList();
};

// 页面初始化
window.onload = async () => {
    await initCardKey();
    await refreshAllData();
};