<template>
  <div class="excel-domain-viewer">
    <div class="page-header">
      <h1>Excel域名查看器</h1>
      <p class="subtitle">上传Excel文件，管理和过滤您的域名列表</p>
    </div>
    
    <div class="upload-section">
      <label class="upload-button">
        <i class="upload-icon">📄</i>
        <span>选择Excel文件</span>
        <input type="file" @change="handleFileUpload" accept=".xlsx, .xls" class="hidden-input" />
      </label>
      <button class="test-file-button" @click="loadTestFile">
        <i class="test-icon">🧪</i>
        <span>测试用Excel文件</span>
      </button>
      <span v-if="selectedFileName" class="file-name">已选择: {{ selectedFileName }}</span>
      <p v-if="errorMessage" class="error-message">{{ errorMessage }}</p>
    </div>
    
    <div v-if="domains.length" class="filter-section">
      <div class="input-group">
        <label>域名前缀</label>
        <textarea v-model="concatText" 
                  placeholder="输入要添加到域名前面的文字" 
                  class="auto-resize-textarea"
                  @input="autoResizeTextarea"
                  rows="3"></textarea>
      </div>
      
      <div class="input-group">
        <label>正则过滤</label>
        <div class="input-with-button">
          <input v-model="regexFilter" placeholder="输入正则表达式过滤域名" :class="{ 'error-input': regexError }" />
        </div>
        <span v-if="regexError" class="input-error">{{ regexError }}</span>
        <div class="regex-tips">
          <button class="test-data-button" @click="fillTestData">
            <i class="test-icon">📝</i>
            <span>填入测试数据</span>
          </button>
        </div>
      </div>
    </div>
    
    <div v-if="domains.length" class="domain-list">
      <div class="list-header">
        <h2>域名列表</h2> 
        <div class="list-actions">
          <button class="auto-analyze-button" 
                  @click="autoAnalyzeAll" 
                  :disabled="isAutoAnalyzing || filteredDomains.length === 0"
                  :class="{ 'analyzing': isAutoAnalyzing }">
            <span v-if="isAutoAnalyzing" class="spinner"></span>
            <span>{{ isAutoAnalyzing ? `自动分析中 (${currentAutoIndex + 1}/${filteredDomains.length})` : '自动发送给AI分析' }}</span>
          </button>
          <span class="domain-count">共 {{ filteredDomains.length }} 个结果</span>
        </div>
      </div>
      <transition-group name="list" tag="ul">
        <li v-for="(domain, index) in filteredDomains" 
            :key="domain + index" 
            :class="{ 'liked': likedDomains.has(domain) }">
          <div class="domain-header">
            <span class="domain">{{ domain }}</span>
            <div class="domain-actions">
              <button class="like-button" 
                      @click="toggleLike(domain)"
                      :class="{ 'liked': likedDomains.has(domain) }">
                <span class="like-icon">{{ likedDomains.has(domain) ? '❤️' : '🤍' }}</span>
              </button>
              <button class="ai-analyze-button" 
                      @click="analyzeWithAI(domain)" 
                      :disabled="isAnalyzing[domain]"
                      :class="{ 'analyzing': isAnalyzing[domain] }">
                <span v-if="isAnalyzing[domain]" class="spinner"></span>
                <span>{{ isAnalyzing[domain] ? '分析中...' : '发送给AI分析' }}</span>
              </button>
            </div>
          </div>
          <div v-if="concatText" class="concat-result">
            <span class="concat-domain">{{ concatText + domain + '.ai'}}</span>
          </div>
          
          <!-- 直接显示思考和答复两个框，不使用AI分析结果外层容器 -->
          <div v-if="aiResults[domain]" class="dual-panel-container">
            <!-- 思考框 - 只显示思考内容 -->
            <div class="panel thinking-panel">
              <div class="panel-header">
                <h4>思考</h4>
                <div class="panel-actions">
                  <button class="copy-button-small" 
                          @click="copyToClipboard(aiReasoning[domain] || '')" 
                          title="复制思考内容">
                    <span>📋</span>
                  </button>
                </div>
              </div>
              <div class="panel-content" :class="{ 'streaming': isAnalyzing[domain] }">
                <div v-if="isAnalyzing[domain] && !aiReasoning[domain]" class="loading-indicator">AI正在思考...</div>
                <div v-else-if="aiReasoning[domain]" v-html="renderedReasoning[domain] || renderMarkdown(aiReasoning[domain])"></div>
                <div v-else class="empty-content">
                  <span class="no-content-icon">📝</span>
                  <span>暂无思考内容</span>
                </div>
              </div>
            </div>
            
            <!-- 答复框 - 只显示答复内容 -->
            <div class="panel answer-panel">
              <div class="panel-header">
                <h4>答复</h4>
                <button class="copy-button-small" 
                        @click="copyToClipboard(aiFinalAnswer[domain] || '')" 
                        title="复制答复内容">
                  <span>📋</span>
                </button>
              </div>
              <div class="panel-content" :class="{ 'streaming': isAnalyzing[domain] }">
                <div v-if="isAnalyzing[domain] && !aiFinalAnswer[domain]" class="loading-indicator">等待AI答复...</div>
                <div v-else-if="aiFinalAnswer[domain]" v-html="renderedAnswer[domain] || renderMarkdown(aiFinalAnswer[domain])"></div>
                <div v-else class="empty-content">
                  <span class="no-content-icon">💬</span>
                  <span>暂无答复内容</span>
                </div>
              </div>
            </div>
          </div>
        </li>
      </transition-group>
    </div>
    
    <div v-else-if="fileUploaded" class="no-domains">
      <p>未在Excel文件中找到域名</p>
    </div>
    
    <div v-if="showCopyToast" class="copy-toast">
      <span>复制成功</span>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue';
import * as XLSX from 'xlsx';
import { analyzeDomain } from '../services/deepseekService';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

// 导入测试文件
import testFileUrl from '../assets/aaa_zzz.xlsx?url';

const domains = ref([]);
const regexFilter = ref('');
const concatText = ref('');
const errorMessage = ref('');
const fileUploaded = ref(false);
const selectedFileName = ref('');
const regexError = ref('');
const showCopyToast = ref(false);
const likedDomains = ref(new Set());
const aiResults = ref({});
const isAnalyzing = ref({});

// 存储原始和渲染后的 Markdown 内容
const renderedMarkdown = ref({});
const renderedReasoning = ref({}); // 渲染后的思考过程
const renderedAnswer = ref({}); // 渲染后的最终结果

// 分别存储思考部分和回答部分
const aiReasoning = ref({});
const aiFinalAnswer = ref({});

// 自动分析相关状态
const isAutoAnalyzing = ref(false);
const currentAutoIndex = ref(0);

// 防抖函数
function debounce(func, wait) {
  let timeout;
  return function(...args) {
    const context = this;
    clearTimeout(timeout);
    timeout = setTimeout(() => func.apply(context, args), wait);
  };
}

// 用于渲染 Markdown 的防抖函数
const debouncedRenderMarkdown = debounce((domain) => {
  if (!aiResults.value[domain]) {
    renderedMarkdown.value[domain] = '';
    return;
  }
  const rawHtml = marked(aiResults.value[domain]);
  renderedMarkdown.value[domain] = DOMPurify.sanitize(rawHtml);
}, 150); // 150ms 的防抖时间

// 用于渲染思考过程的防抖函数
const debouncedRenderReasoning = debounce((domain) => {
  if (!aiReasoning.value[domain]) {
    renderedReasoning.value[domain] = '';
    return;
  }
  const rawHtml = marked(aiReasoning.value[domain]);
  renderedReasoning.value[domain] = DOMPurify.sanitize(rawHtml);
}, 150);

// 用于渲染最终答案的防抖函数
const debouncedRenderAnswer = debounce((domain) => {
  if (!aiFinalAnswer.value[domain]) {
    renderedAnswer.value[domain] = '';
    return;
  }
  const rawHtml = marked(aiFinalAnswer.value[domain]);
  renderedAnswer.value[domain] = DOMPurify.sanitize(rawHtml);
}, 150);

// 过滤后的域名
const filteredDomains = computed(() => {
  if (!regexFilter.value) {
    return [...domains.value];
  }
  
  try {
    const regex = new RegExp(regexFilter.value);
    regexError.value = '';
    return domains.value.filter(domain => regex.test(domain));
  } catch (error) {
    regexError.value = '正则表达式无效: ' + error.message;
    return [...domains.value];
  }
});

// 处理文件上传
async function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  selectedFileName.value = file.name;
  fileUploaded.value = true;
  errorMessage.value = '';
  
  try {
    const data = await readExcelFile(file);
    domains.value = data;
  } catch (error) {
    errorMessage.value = `解析错误: ${error.message}`;
    domains.value = [];
  }
}

// 加载测试文件
async function loadTestFile() {
  try {
    errorMessage.value = '';
    selectedFileName.value = 'aaa_zzz.xlsx';
    fileUploaded.value = true;
    
    const response = await fetch(testFileUrl);
    const arrayBuffer = await response.arrayBuffer();
    const data = await parseExcelData(arrayBuffer);
    domains.value = data;
  } catch (error) {
    errorMessage.value = `加载测试文件失败: ${error.message}`;
    domains.value = [];
  }
}

// 读取Excel文件
function readExcelFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = parseExcelData(e.target.result);
        resolve(data);
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = (error) => {
      reject(error);
    };
    
    reader.readAsArrayBuffer(file);
  });
}

// 解析Excel数据
function parseExcelData(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  
  // 获取第一个工作表
  const firstSheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[firstSheetName];
  
  // 将工作表转换为JSON数组
  const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
  
  // 提取域名 - 包含所有非空单元格的值
  const domains = [];
  
  for (const row of jsonData) {
    for (const cell of row) {
      // 跳过空值和非字符串类型
      if (cell && typeof cell === 'string') {
        // 移除空格并检查是否为空
        const trimmed = cell.trim();
        if (trimmed) {
          domains.push(trimmed);
        }
      }
    }
  }
  
  return domains;
}

// 收藏域名
function toggleLike(domain) {
  if (likedDomains.value.has(domain)) {
    likedDomains.value.delete(domain);
  } else {
    likedDomains.value.add(domain);
  }
}

// 使用AI分析域名
async function analyzeWithAI(domain) {
  isAnalyzing.value[domain] = true;
  
  try {
    // 清除之前的结果
    aiResults.value[domain] = '';
    aiReasoning.value[domain] = '';
    aiFinalAnswer.value[domain] = '';
    renderedReasoning.value[domain] = '';
    renderedAnswer.value[domain] = '';
    
    // 启动流式处理分析
    analyzeDomain(domain, (streamData) => {
      // 更新思考内容
      if (streamData.reasoningContent) {
        aiReasoning.value[domain] = streamData.reasoningContent;
        // 防抖更新 HTML 渲染
        debouncedRenderReasoning(domain);
      }
      
      // 更新最终答案内容
      if (streamData.finalContent) {
        aiFinalAnswer.value[domain] = streamData.finalContent;
        // 防抖更新 HTML 渲染
        debouncedRenderAnswer(domain);
      }
      
      // 更新总结果（向后兼容）
      aiResults.value[domain] = streamData.reasoningContent + 
                               (streamData.finalContent ? '\n\n' + streamData.finalContent : '');
    });
    
  } catch (error) {
    console.error('分析域名时发生错误:', error);
    aiResults.value[domain] = `分析失败: ${error.message}`;
  } finally {
    // 确保最后渲染一次
    setTimeout(() => {
      isAnalyzing.value[domain] = false;
    }, 500);
  }
}

// 自动分析所有域名
async function autoAnalyzeAll() {
  if (isAutoAnalyzing.value || filteredDomains.value.length === 0) return;
  
  isAutoAnalyzing.value = true;
  currentAutoIndex.value = 0;
  
  try {
    for (let i = 0; i < filteredDomains.value.length; i++) {
      currentAutoIndex.value = i;
      const domain = filteredDomains.value[i];
      
      // 跳过已分析的域名
      if (aiResults.value[domain]) continue;
      
      // 分析当前域名
      isAnalyzing.value[domain] = true;
      
      try {
        // 流式处理
        await new Promise((resolve) => {
          // 清除之前的结果
          aiReasoning.value[domain] = '';
          aiFinalAnswer.value[domain] = '';
          renderedReasoning.value[domain] = '';
          renderedAnswer.value[domain] = '';
          
          analyzeDomain(domain, (streamData) => {
            // 更新思考内容
            if (streamData.reasoningContent) {
              aiReasoning.value[domain] = streamData.reasoningContent;
              debouncedRenderReasoning(domain);
            }
            
            // 更新最终答案内容
            if (streamData.finalContent) {
              aiFinalAnswer.value[domain] = streamData.finalContent;
              debouncedRenderAnswer(domain);
            }
            
            // 更新总结果（向后兼容）
            aiResults.value[domain] = streamData.reasoningContent + 
                                    (streamData.finalContent ? '\n\n' + streamData.finalContent : '');
            
            // 如果已完成，则解析Promise
            if (streamData.finalContent && !streamData.isReasoningPhase) {
              resolve();
            }
          });
          
          // 添加超时，确保即使API未返回final也能继续
          setTimeout(() => {
            resolve();
          }, 30000); // 30秒超时
        });
      } finally {
        isAnalyzing.value[domain] = false;
        // 在域名之间添加短暂延迟，避免API速率限制
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  } finally {
    isAutoAnalyzing.value = false;
  }
}

// 复制文本到剪贴板
async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    showCopyToast.value = true;
    setTimeout(() => {
      showCopyToast.value = false;
    }, 2000);
  } catch (error) {
    console.error('复制失败:', error);
  }
}

// 自动调整文本框高度
function autoResizeTextarea(e) {
  const textarea = e.target;
  textarea.style.height = 'auto';
  textarea.style.height = textarea.scrollHeight + 'px';
}

// 渲染Markdown内容
function renderMarkdown(text) {
  if (!text) return '';
  const rawHtml = marked(text);
  return DOMPurify.sanitize(rawHtml);
}

// 填入测试数据
function fillTestData() {
  regexFilter.value = '^(a|b|c).*[0-9]$';
}
</script>

<style>
.excel-domain-viewer {
  font-family: Arial, sans-serif;
  max-width: 1200px;
  margin: 0 auto;
  padding: 20px;
  color: #333;
}

.page-header {
  text-align: center;
  margin-bottom: 30px;
}

.page-header h1 {
  font-size: 2.5rem;
  color: #2c3e50;
  margin-bottom: 10px;
}

.page-header .subtitle {
  font-size: 1.2rem;
  color: #7f8c8d;
}

.upload-section {
  display: flex;
  align-items: center;
  gap: 15px;
  margin-bottom: 30px;
  flex-wrap: wrap;
}

.upload-button, .test-file-button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 20px;
  border-radius: 8px;
  font-weight: bold;
  cursor: pointer;
  transition: all 0.3s ease;
}

.upload-button {
  background-color: #4CAF50;
  color: white;
  border: none;
}

.upload-button:hover {
  background-color: #45a049;
}

.test-file-button {
  background-color: #2196F3;
  color: white;
  border: none;
}

.test-file-button:hover {
  background-color: #0b7dda;
}

.hidden-input {
  display: none;
}

.file-name {
  font-size: 0.9rem;
  color: #666;
}

.error-message {
  color: #e74c3c;
  font-weight: bold;
}

.filter-section {
  margin-bottom: 30px;
  display: flex;
  flex-direction: column;
  gap: 15px;
}

.input-group {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.input-group label {
  font-weight: bold;
  color: #2c3e50;
}

.input-group input, .input-group textarea {
  padding: 10px;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 1rem;
}

.input-with-button {
  display: flex;
  gap: 10px;
}

.input-with-button input {
  flex-grow: 1;
}

.error-input {
  border-color: #e74c3c !important;
}

.input-error {
  color: #e74c3c;
  font-size: 0.85rem;
}

.regex-tips {
  display: flex;
  justify-content: flex-end;
  margin-top: 5px;
}

.test-data-button {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 5px 10px;
  background-color: #f5f5f5;
  border: 1px solid #ddd;
  border-radius: 4px;
  font-size: 0.85rem;
  cursor: pointer;
}

.test-data-button:hover {
  background-color: #e9e9e9;
}

.domain-list {
  margin-top: 20px;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 15px;
}

.list-header h2 {
  margin: 0;
  color: #2c3e50;
}

.list-actions {
  display: flex;
  align-items: center;
  gap: 15px;
}

.auto-analyze-button {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background-color: #9b59b6;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.3s ease;
}

.auto-analyze-button:hover:not(:disabled) {
  background-color: #8e44ad;
}

.auto-analyze-button:disabled {
  background-color: #d2b9e0;
  cursor: not-allowed;
}

.auto-analyze-button.analyzing {
  background-color: #8e44ad;
}

.domain-count {
  font-size: 0.9rem;
  color: #7f8c8d;
}

.domain-list ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.domain-list li {
  margin-bottom: 20px;
  padding: 15px;
  border-radius: 8px;
  background-color: #f9f9f9;
  box-shadow: 0 2px 4px rgba(0,0,0,0.05);
  transition: all 0.3s ease;
}

.domain-list li:hover {
  box-shadow: 0 4px 8px rgba(0,0,0,0.1);
}

.domain-list li.liked {
  border-left: 4px solid #e74c3c;
}

.domain-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
}

.domain {
  font-size: 1.2rem;
  font-weight: bold;
  color: #333;
}

.domain-actions {
  display: flex;
  gap: 10px;
}

.like-button, .ai-analyze-button {
  padding: 6px 12px;
  border-radius: 4px;
  border: none;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  align-items: center;
  gap: 5px;
}

.like-button {
  background-color: #f8f8f8;
  border: 1px solid #ddd;
}

.like-button:hover {
  background-color: #f0f0f0;
}

.like-button.liked {
  background-color: #ffebee;
  border-color: #ffcdd2;
}

.ai-analyze-button {
  background-color: #3498db;
  color: white;
}

.ai-analyze-button:hover:not(:disabled) {
  background-color: #2980b9;
}

.ai-analyze-button:disabled {
  background-color: #bdc3c7;
  cursor: not-allowed;
}

.ai-analyze-button.analyzing {
  background-color: #2980b9;
}

.concat-result {
  margin-top: 10px;
  padding: 8px 12px;
  background-color: #e3f2fd;
  border-radius: 4px;
  font-size: 0.95rem;
}

.concat-domain {
  font-weight: bold;
  color: #1565C0;
}

.no-domains {
  text-align: center;
  padding: 30px;
  color: #7f8c8d;
  font-size: 1.2rem;
}

.copy-toast {
  position: fixed;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  background-color: rgba(0,0,0,0.8);
  color: white;
  padding: 10px 20px;
  border-radius: 4px;
  z-index: 1000;
  animation: fadeIn 0.3s, fadeOut 0.3s 1.7s;
}

.upload-icon, .test-icon, .like-icon, .no-content-icon {
  font-size: 1.2rem;
}

.auto-resize-textarea {
  min-height: 60px;
  resize: none;
  overflow-y: hidden;
}

/* 动画效果 */
.list-enter-active, .list-leave-active {
  transition: all 0.5s ease;
}

.list-enter-from, .list-leave-to {
  opacity: 0;
  transform: translateY(30px);
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes fadeOut {
  from { opacity: 1; }
  to { opacity: 0; }
}

.spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255,255,255,0.3);
  border-radius: 50%;
  border-top-color: #fff;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

/* AI结果容器样式 */
.dual-panel-container {
  display: flex;
  flex-direction: column;
  gap: 15px;
  margin-top: 15px;
  width: 100%;
}

@media (min-width: 768px) {
  .dual-panel-container {
    flex-direction: row;
  }
}

.panel {
  flex: 1;
  border: 1px solid #e1e1e1;
  border-radius: 6px;
  overflow: hidden;
}

.thinking-panel {
  background-color: #fafafa;
}

.answer-panel {
  background-color: #f5f9ff;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 10px 15px;
  background-color: #f1f1f1;
  border-bottom: 1px solid #e1e1e1;
}

.thinking-panel .panel-header {
  background-color: #f5f5f5;
}

.answer-panel .panel-header {
  background-color: #e6f0fd;
}

.panel-header h4 {
  margin: 0;
  font-size: 1rem;
  color: #333;
}

.panel-actions {
  display: flex;
  gap: 5px;
}

.copy-button-small {
  background: none;
  border: none;
  cursor: pointer;
  font-size: 1rem;
  color: #666;
  padding: 2px 5px;
}

.copy-button-small:hover {
  color: #333;
}

.panel-content {
  padding: 15px;
  font-size: 0.95rem;
  line-height: 1.5;
  max-height: 300px;
  overflow-y: auto;
}

.panel-content.streaming {
  position: relative;
}

.empty-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 30px 15px;
  color: #999;
  text-align: center;
}

.no-content-icon {
  font-size: 2rem;
  margin-bottom: 10px;
  opacity: 0.5;
}

.loading-indicator {
  color: #666;
  font-style: italic;
  text-align: center;
  padding: 20px;
}
</style>