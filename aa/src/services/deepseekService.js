/**
 * DeepSeek API 服务
 * 处理与DeepSeek API的通信
 * 文档: https://api-docs.deepseek.com/
 */

// DeepSeek API配置
const DEEPSEEK_API_KEY = 'sk-afcb0b06bdf446838dcc874e25eb764c';
const DEEPSEEK_API_URL = 'https://api.deepseek.com/chat/completions';

/**
 * 使用DeepSeek API分析域名
 * @param {string} domain 要分析的域名
 * @param {Function} onStream 流式数据回调函数
 * @returns {Promise<string>} 分析结果
 */
export async function analyzeDomain(domain, onStream = null) {
  try {
    // 构建请求体
    const requestBody = {
      model: "deepseek-reasoner",
      messages: [
        {
          role: "system",
          content: `你是一位专业的域名分析师和域名估价专家。你将根据用户提供的域名进行详细分析，包括：
1. 域名的基本构成和类型（通用、行业特定等）
2. 域名的品牌价值、记忆性和市场潜力
3. 域名在当前环境下的大致估价范围
4. 推荐的使用场景和行业

请确保分析客观、专业，并提供具体的理由支持你的观点。`
        },
        {
          role: "user",
          content: `请帮我分析以下域名的价值、适用场景和推荐行业：${domain}`
        }
      ],
      stream: true,
      max_tokens: 4000
    };
    
    // 用于流数据处理的数据累积变量
    let reasoningContent = '';
    let finalContent = '';
    
    // 额外的状态跟踪变量
    let isReasoningPhase = true; // 初始假设处于思考阶段
    let hasProcessedReasoning = false; // 跟踪是否已处理过思考结束信号
    let reasoningDone = false; // 跟踪思考阶段是否已结束
    
    // 流式更新缓冲区管理器
    const streamBuffer = {
      reasoningChunks: [],
      finalChunks: [],
      lastUpdateTime: 0,
      updateInterval: 50, // 50毫秒更新一次UI，增加流畅感

      // 添加思考内容
      addReasoning(content) {
        this.reasoningChunks.push(content);
        this.flushIfNeeded();
      },

      // 添加答复内容
      addFinal(content) {
        this.finalChunks.push(content);
        this.flushIfNeeded();
      },

      // 检查并执行更新
      flushIfNeeded() {
        const now = Date.now();
        if (now - this.lastUpdateTime >= this.updateInterval) {
          this.flush();
        }
      },

      // 强制更新UI
      flush() {
        if (this.reasoningChunks.length > 0 || this.finalChunks.length > 0) {
          if (this.reasoningChunks.length > 0) {
            reasoningContent += this.reasoningChunks.join('');
            this.reasoningChunks = [];
          }
          
          if (this.finalChunks.length > 0) {
            finalContent += this.finalChunks.join('');
            this.finalChunks = [];
          }
          
          // 调用回调更新UI
          if (onStream) {
            onStream({
              reasoningContent,
              finalContent,
              isReasoningPhase
            });
          }
          
          this.lastUpdateTime = Date.now();
        }
      }
    };
    
    // 定期刷新缓冲区，确保没有内容被延迟
    const flushInterval = setInterval(() => {
      streamBuffer.flush();
    }, streamBuffer.updateInterval);
    
    // 如果提供了回调函数，使用流式处理
    if (onStream) {
      // 发送请求到DeepSeek API并获取流式响应
      const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify(requestBody)
      });

      // 检查响应状态
      if (!response.ok) {
        clearInterval(flushInterval);
        const errorData = await response.json().catch(() => ({}));
        console.error('DeepSeek API错误:', errorData);
        throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
      }

      // 获取reader以读取流数据
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let done = false;
      
      while (!done) {
        const { value, done: doneReading } = await reader.read();
        done = doneReading;
        
        if (done) {
          // 流结束
          console.log('流式响应结束', { 
            reasoningContent: reasoningContent.length, 
            finalContent: finalContent.length,
            finalContentJSON: JSON.stringify(finalContent.substring(0, 100))
          });
          
          // 解耦：移除流结束时从思考内容提取结论的逻辑
          // 只发送最终确认更新
          if (finalContent.length > 0) {
            // 流结束时发送最终确认更新
            console.log('流结束，发送最终确认更新:', finalContent.substring(0, 50));
            // 确保最后一次更新被发送
            streamBuffer.flush();
          }
          clearInterval(flushInterval);
          break;
        }
        
        // 解码并处理当前块
        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          // 跳过空行
          if (!line.trim() || !line.startsWith('data:')) continue;
          
          // 忽略心跳信息
          if (line === 'data: [DONE]') {
            console.log('收到 [DONE] 信号');
            continue;
          }
          
          // 提取JSON部分（去掉"data: "前缀）
          try {
            const jsonStr = line.substring(5);
            const json = JSON.parse(jsonStr);
            
            // 检查是否收到完整的消息对象
            if (json.choices && json.choices[0].message) {
              console.log('收到完整的消息对象:', json.choices[0].message);
              
              // 检查是否有完整的回答
              if (json.choices[0].message.content) {
                finalContent = json.choices[0].message.content;
                isReasoningPhase = false;
                streamBuffer.flush(); // 立即更新UI
              }
              
              // 检查是否有完整的思考过程
              if (json.choices[0].message.reasoning_content) {
                reasoningContent = json.choices[0].message.reasoning_content;
                streamBuffer.flush(); // 立即更新UI
              }
              continue;
            }
            
            // 检查是否有 delta.reasoning_content
            if (json.choices[0].delta.reasoning_content !== undefined) {
              // 获取delta值，如果是null则默认为空字符串
              const delta = json.choices[0].delta.reasoning_content || '';
              
              // 如果正在使用分段显示，则根据推理阶段状态处理
              if (isReasoningPhase) {
                streamBuffer.addReasoning(delta);
              }
              
              // 检查是否有特殊标记表示推理结束
              if (delta.includes("我的分析如下：")) {
                reasoningDone = true;
              }
              
              continue;
            }
            
            // 检查是否有 delta.content
            if (json.choices[0].delta.content !== undefined) {
              // 如果收到content，表示已经进入了最终回答阶段
              const delta = json.choices[0].delta.content || '';
              
              // 标记为非推理阶段
              if (isReasoningPhase) {
                isReasoningPhase = false;
              }
              
              // 添加到最终内容
              streamBuffer.addFinal(delta);
              continue;
            }
          } catch (error) {
            console.error('解析流数据时出错:', error, { line });
            continue;
          }
        }
      }
      
      // 确保回调获得最后一次更新
      if (onStream) {
        onStream({
          reasoningContent,
          finalContent,
          isReasoningPhase: false
        });
      }
      
      // 合并结果并返回
      return reasoningContent + '\n\n' + finalContent;
      
    } else {
      // 非流式处理模式 - 旧模式，不再使用但保留向后兼容
      const response = await fetch(DEEPSEEK_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
          ...requestBody,
          stream: false
        })
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        console.error('DeepSeek API错误:', errorData);
        throw new Error(`API请求失败: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      return data.choices[0].message.content;
    }
  } catch (error) {
    console.error('DeepSeek API调用失败:', error);
    throw error;
  }
}