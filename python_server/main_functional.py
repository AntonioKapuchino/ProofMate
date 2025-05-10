import os
import json
import nbformat
import logging
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from typing import List, Dict, Any, Optional
import uvicorn
from pydantic import BaseModel
from dotenv import load_dotenv
import openai
import requests
import re
import io
import pandas as pd
from fastapi.responses import Response
from datetime import datetime
import openpyxl

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler("python_server_log.txt"),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger("proofmate")

# Load environment variables
load_dotenv()

# Set OpenAI API key and base URL
api_key = os.getenv("OPENAI_API_KEY")
api_base = os.getenv("OPENAI_API_BASE")

# Configure OpenAI client
openai.api_key = api_key
openai.base_url = api_base

# Get other environment variables
node_server_url = os.getenv("NODE_SERVER_URL", "http://localhost:5000")
environment = os.getenv("ENVIRONMENT", "development")

logger.info(f"OpenAI API Key: {api_key[:5]}...{api_key[-5:] if api_key else None}")
logger.info(f"OpenAI Base URL: {api_base}")
logger.info(f"Environment: {environment}")
logger.info(f"Node Server URL: {node_server_url}")

app = FastAPI(title="ProofMate - Notebook Analysis API")

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Models
class ErrorHighlight(BaseModel):
    cell_index: int
    line_start: int
    line_end: int
    error_type: str
    error_message: str
    suggestion: str

class AnalysisResult(BaseModel):
    error_summary: str
    detailed_feedback: Dict[str, Any]
    confidence_score: float
    grade: float
    cell_annotations: List[Dict[str, Any]]
    error_highlights: List[ErrorHighlight] = []

# Utility functions
def extract_cells_from_notebook(notebook_content):
    """Parse notebook and extract cells with their content and metadata."""
    try:
        nb = nbformat.reads(notebook_content.decode('utf-8'), as_version=4)
        cells = []
        
        for i, cell in enumerate(nb.cells):
            if cell.cell_type == 'code':
                cells.append({
                    'index': i,
                    'type': 'code',
                    'content': cell.source,
                    'outputs': cell.outputs if hasattr(cell, 'outputs') else []
                })
            elif cell.cell_type == 'markdown':
                cells.append({
                    'index': i,
                    'type': 'markdown',
                    'content': cell.source
                })
        
        return cells
    except Exception as e:
        logger.error(f"Error parsing notebook: {str(e)}")
        return None

def detect_math_topic(cells):
    """Detect the mathematical topic from notebook cells."""
    full_content = " ".join([cell.get('content', '') for cell in cells])
    
    topics = {
        'linear_algebra': ['matrix', 'vector', 'eigenvalue', 'eigenvector', 'determinant', 'linear system'],
        'calculus': ['derivative', 'integral', 'limit', 'differential', 'integration'],
        'geometry': ['ellipse', 'circle', 'parabola', 'hyperbola', 'conic section'],
        'statistics': ['probability', 'distribution', 'mean', 'variance', 'regression'],
        'number_theory': ['prime', 'divisor', 'modulo', 'congruence', 'diophantine']
    }
    
    topic_counts = {}
    for topic, keywords in topics.items():
        count = sum(1 for keyword in keywords if keyword.lower() in full_content.lower())
        topic_counts[topic] = count
    
    if all(count == 0 for count in topic_counts.values()):
        return "general_mathematics"
    
    return max(topic_counts.items(), key=lambda x: x[1])[0]

def create_prompt_for_analysis(topic, reference_nb_repr, student_nb_repr):
    """Create a specialized prompt based on the detected mathematical topic."""
    
    topic_specific_instructions = {
        'linear_algebra': "Focus on matrix operations, vector spaces, eigenvalues/eigenvectors, and linear transformations.",
        'calculus': "Focus on derivative calculations, integration techniques, limit evaluations, and applications.",
        'geometry': "Focus on conic sections, coordinate geometry, transformations, and geometric constructions.",
        'statistics': "Focus on data analysis, probability calculations, hypothesis testing, and statistical modeling.",
        'number_theory': "Focus on prime numbers, divisibility, modular arithmetic, and algebraic structures.",
        'general_mathematics': "Focus on correctness of calculations, mathematical reasoning, and implementation of algorithms."
    }
    
    return f"""
    As an expert mathematician specializing in {topic}, analyze these mathematics solutions.
    {topic_specific_instructions.get(topic, topic_specific_instructions['general_mathematics'])}
    
    # Reference Solution:
    ```python
    {reference_nb_repr}
    ```
    
    # Student Solution:
    ```python
    {student_nb_repr}
    ```
    
    Please analyze the student's solution against the reference solution and provide a detailed analysis with the following structure:

    ## Summary
    [Provide a concise summary of the overall quality of the solution and major issues]

    ## Strengths
    - [List specific strengths, with each point starting with a dash]
    - [Be detailed and specific]

    ## Areas for Improvement
    - [List specific weaknesses or errors, with each point starting with a dash]
    - [Be detailed and specific]

    ## Recommendations
    - [List specific suggestions for improvement, with each point starting with a dash]
    - [Be practical and actionable]

    ## Cell Annotations
    Cell X: [Specific feedback for cell X, including errors and suggestions]
    Cell Y: [Specific feedback for cell Y, including errors and suggestions]
    [Add annotations for all cells that need feedback]

    ## Grade and Confidence
    Grade: [Assign a grade from 0-10]
    Confidence: [Specify your confidence level from 0-1]

    IMPORTANT: Provide specific and detailed cell annotations for any problematic cells, as this is crucial for the student's understanding. Ensure your feedback is constructive and helpful.
    """

def parse_ai_response(response_text):
    """Parse the AI response into structured feedback."""
    logger.info("Parsing AI response")
    
    # Extract summary - use the first paragraph that's not empty
    paragraphs = [p.strip() for p in response_text.split('\n\n') if p.strip()]
    error_summary = paragraphs[0] if paragraphs else "Analysis completed."
    
    if len(error_summary) < 20 and len(paragraphs) > 1:
        # First paragraph might be too short, try the next one
        error_summary = paragraphs[1]
    
    # Try to extract grade
    grade_match = re.search(r'grade:?\s*(\d+(?:\.\d+)?)', response_text, re.IGNORECASE)
    grade = float(grade_match.group(1)) if grade_match else 7.5  # Default grade
    
    # Try to extract confidence
    confidence_match = re.search(r'confidence:?\s*(\d+(?:\.\d+)?)', response_text, re.IGNORECASE)
    confidence = float(confidence_match.group(1)) if confidence_match else 0.9  # Default confidence
    
    # Extract strengths
    strengths = []
    # Try multiple patterns for strength extraction
    strength_patterns = [
        r'(?:strength|сильн[а-я]+\s+сторон[а-я]+|положительн[а-я]+)(?:[s:]\s*|\s*:\s*)(.*?)(?=\n|$)',
        r'(?:strength|сильн[а-я]+\s+сторон[а-я]+)[^\n:]*\n\s*[-*•]?\s*(.*?)(?=\n|$)',
        r'(?<=\n)[-*•]\s*(.*?)(?=\n|$)'  # Look for bullet points after strength headers
    ]
    
    for pattern in strength_patterns:
        matched_strengths = re.findall(pattern, response_text, re.IGNORECASE | re.MULTILINE)
        if matched_strengths:
            strengths.extend([s.strip() for s in matched_strengths if s.strip()])
    
    # Extract weaknesses
    weaknesses = []
    # Try multiple patterns for weakness extraction
    weakness_patterns = [
        r'(?:weakness|issue|error|problem|област[а-я]+\s+для\s+улучшени[а-я]+|недостат[а-я]+|ошибк[а-я]+)(?:[s:]\s*|\s*:\s*)(.*?)(?=\n|$)',
        r'(?:weakness|issue|error|problem|област[а-я]+\s+для\s+улучшени[а-я]+)[^\n:]*\n\s*[-*•]?\s*(.*?)(?=\n|$)'
    ]
    
    for pattern in weakness_patterns:
        matched_weaknesses = re.findall(pattern, response_text, re.IGNORECASE | re.MULTILINE)
        if matched_weaknesses:
            weaknesses.extend([w.strip() for w in matched_weaknesses if w.strip()])
    
    # Extract suggestions
    suggestions = []
    # Try multiple patterns for suggestion extraction
    suggestion_patterns = [
        r'(?:suggestion|recommendation|improvement|рекомендаци[а-я]+)(?:[s:]\s*|\s*:\s*)(.*?)(?=\n|$)',
        r'(?:suggestion|recommendation|improvement|рекомендаци[а-я]+)[^\n:]*\n\s*[-*•]?\s*(.*?)(?=\n|$)'
    ]
    
    for pattern in suggestion_patterns:
        matched_suggestions = re.findall(pattern, response_text, re.IGNORECASE | re.MULTILINE)
        if matched_suggestions:
            suggestions.extend([s.strip() for s in matched_suggestions if s.strip()])
    
    # Extract cell annotations
    cell_annotations = []
    
    # Look for a Cell Annotations section in the response
    cell_section_match = re.search(r'(?:##?\s*Cell\s+Annotations|Аннотации\s+к\s+ячейкам)(.*?)(?=##|\Z)', 
                                 response_text, re.IGNORECASE | re.DOTALL)
    
    if cell_section_match:
        cell_section = cell_section_match.group(1).strip()
        
        # Extract annotations from bullet points with cell references
        # This pattern looks for: - **Cell X** or - Cell X or Cell X:
        bullet_cell_annotations = re.findall(
            r'[-*•]?\s*(?:\*\*)?(?:cell|ячейка)\s*(\d+)(?:\*\*)?[:\s-]+\s*(.*?)(?=\n\s*[-*•]|\n\s*(?:\*\*)?(?:cell|ячейка)|\Z)', 
            cell_section, 
            re.IGNORECASE | re.DOTALL
        )
        
        for cell_idx, comment in bullet_cell_annotations:
            try:
                cell_index = int(cell_idx.strip())
                comment_text = comment.strip()
                
                # Check if this cell already has annotations
                existing_cell = next((c for c in cell_annotations if c["cell_index"] == cell_index), None)
                if existing_cell:
                    existing_cell["comments"].append(comment_text)
                else:
                    cell_annotations.append({
                        "cell_index": cell_index,
                        "comments": [comment_text]
                    })
            except ValueError:
                logger.warning(f"Could not parse cell index from: {cell_idx}")
    
    # If we didn't find cell annotations in a dedicated section, try other patterns
    if not cell_annotations:
        # Look for specific cell mentions throughout the text - both English and Russian
        cell_mention_patterns = [
            r'(?:cell|ячейка|код\s+в\s+ячейке)\s*(\d+).*?[:：](.*?)(?=\n\s*(?:cell|ячейка|\n|$))',
            r'(?:cell|ячейка|код\s+в\s+ячейке)\s*(\d+)[^\n:]*\n\s*[-*•]?\s*(.*?)(?=\n|$)'
        ]
        
        for pattern in cell_mention_patterns:
            cell_mentions = re.findall(pattern, response_text, re.IGNORECASE | re.DOTALL)
            for cell_idx, comment in cell_mentions:
                try:
                    cell_index = int(cell_idx.strip())
                    comment_text = comment.strip()
                    
                    # Check if this cell already has annotations
                    existing_cell = next((c for c in cell_annotations if c["cell_index"] == cell_index), None)
                    if existing_cell:
                        existing_cell["comments"].append(comment_text)
                    else:
                        cell_annotations.append({
                            "cell_index": cell_index,
                            "comments": [comment_text]
                        })
                except ValueError:
                    logger.warning(f"Could not parse cell index from: {cell_idx}")
    
    # If we still don't have meaningful data, extract it from structured sections
    # This fallback makes the function more robust
    if not strengths and not weaknesses and len(cell_annotations) < 2:
        logger.warning("Regular parsing patterns didn't extract enough information. Trying fallback extraction methods.")
        
        # Look for structured sections in the response
        sections = {}
        current_section = None
        
        for line in response_text.split('\n'):
            line = line.strip()
            if not line:
                continue
                
            # Check if this line is a section header
            if re.match(r'^#+\s+\w+|^[A-ZА-Я][A-ZА-Яa-zа-я\s]+:', line):
                current_section = line.split(':', 1)[0].strip('# ').lower()
                sections[current_section] = []
            elif current_section and line.startswith('-') or line.startswith('*'):
                sections[current_section].append(line[1:].strip())
        
        # Extract data from identified sections
        for section_name, items in sections.items():
            if any(keyword in section_name for keyword in ['strength', 'сильн', 'положительн']):
                strengths.extend(items)
            elif any(keyword in section_name for keyword in ['weakness', 'issue', 'error', 'problem', 'област', 'недостат', 'ошибк']):
                weaknesses.extend(items)
            elif any(keyword in section_name for keyword in ['suggestion', 'recommendation', 'рекомендаци']):
                suggestions.extend(items)
    
    # Add default values if we still don't have anything
    if not strengths:
        strengths = ["The solution demonstrates understanding of core mathematical concepts"]
    if not weaknesses and "error" in error_summary.lower():
        # Extract weakness from the summary if possible
        weaknesses = [error_summary]
    
    # Build the structured feedback
    detailed_feedback = {
        "strengths": strengths,
        "weaknesses": weaknesses,
        "suggestions": suggestions if suggestions else ["Review the specific cell annotations for detailed improvement suggestions"]
    }
    
    # Log the extracted information for debugging
    logger.info(f"Extracted {len(strengths)} strengths, {len(weaknesses)} weaknesses, {len(suggestions)} suggestions, and {len(cell_annotations)} cell annotations")
    
    return {
        "error_summary": error_summary,
        "detailed_feedback": detailed_feedback,
        "confidence_score": min(max(confidence, 0), 1),  # Ensure between 0 and 1
        "grade": min(max(grade, 0), 10),  # Ensure between 0 and 10
        "cell_annotations": cell_annotations
    }

def call_openai_api_alternative(prompt, model="gpt-4o"):
    """
    Alternative method to call OpenAI API using requests library directly.
    """
    api_key = os.getenv("OPENAI_API_KEY")
    base_url = os.getenv("OPENAI_API_BASE")
    
    # Ensure base URL ends with /v1
    if base_url and not base_url.endswith('/v1'):
        base_url = f"{base_url}/v1"
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "You are an AI assistant that analyzes Jupyter notebooks for mathematical problems."},
            {"role": "user", "content": prompt}
        ],
        "temperature": 0.3
    }
    
    try:
        logger.info(f"Using alternative method to call OpenAI API with model: {model}")
        # Fix: Make sure to add a slash between base URL and chat/completions
        api_endpoint = f"{base_url}/chat/completions"
        logger.info(f"API endpoint: {api_endpoint}")
        
        response = requests.post(
            api_endpoint, 
            headers=headers,
            json=payload,
            timeout=30
        )
        
        if response.status_code == 200:
            result = response.json()
            content = result["choices"][0]["message"]["content"]
            logger.info(f"✅ Alternative method successful")
            return content
        else:
            logger.error(f"❌ Alternative method failed with status {response.status_code}: {response.text}")
            return None
    except Exception as e:
        logger.error(f"❌ Alternative method exception: {str(e)}")
        return None

# Routes
@app.get("/")
async def root():
    return {"message": "ProofMate Notebook Analysis API is running"}

@app.get("/healthcheck")
async def healthcheck():
    return {"status": "ok", "environment": environment}

@app.post("/api/analyze", response_model=AnalysisResult)
async def analyze_notebook(
    notebook_file: UploadFile = File(...),
    reference_solution: UploadFile = File(...),
    task_id: str = Form(...)
):
    """
    Analyze a student's notebook against a reference solution.
    Returns detailed feedback, error analysis, and a grade.
    """
    logger.info(f"Received analysis request for task {task_id}")
    logger.info(f"Student notebook: {notebook_file.filename}, Reference: {reference_solution.filename}")
    
    try:
        # Read the contents of both files
        student_content = await notebook_file.read()
        reference_content = await reference_solution.read()
        
        # Validate the file content
        if len(student_content) < 10 or len(reference_content) < 10:
            logger.error(f"One or both files appear to be empty or too small")
            raise HTTPException(status_code=400, detail="One or both notebook files appear to be empty or invalid")
        
        # Parse notebooks
        student_cells = extract_cells_from_notebook(student_content)
        reference_cells = extract_cells_from_notebook(reference_content)
        
        if not student_cells or not reference_cells:
            logger.error("Failed to parse notebook files")
            raise HTTPException(status_code=400, detail="Failed to parse notebook files. Please ensure they are valid Jupyter notebooks.")
        
        # Detect the mathematical topic
        topic = detect_math_topic(student_cells + reference_cells)
        logger.info(f"Detected mathematical topic: {topic}")
        
        # Create simplified representations for the API call
        student_nb_repr = student_content.decode('utf-8')
        reference_nb_repr = reference_content.decode('utf-8')
        
        # Truncate if too large
        max_chars = 15000  # Reasonable limit for API
        if len(student_nb_repr) > max_chars:
            logger.info(f"Student notebook content too large ({len(student_nb_repr)} chars), truncating")
            student_nb_repr = student_nb_repr[:max_chars] + "... [truncated]"
        if len(reference_nb_repr) > max_chars:
            logger.info(f"Reference notebook content too large ({len(reference_nb_repr)} chars), truncating")
            reference_nb_repr = reference_nb_repr[:max_chars] + "... [truncated]"
        
        # Create analysis prompt
        analysis_prompt = create_prompt_for_analysis(topic, reference_nb_repr, student_nb_repr)
        
        # Use the direct HTTP method as it's known to work
        logger.info("Calling OpenAI API using direct HTTP request...")
        ai_response = call_openai_api_alternative(analysis_prompt)
        
        if not ai_response:
            # If direct method fails, try the SDK as fallback
            logger.info("Direct HTTP request failed, trying SDK as fallback...")
            try:
                response = openai.chat.completions.create(
                    model="gpt-4o",
                    messages=[
                        {"role": "system", "content": "You are an AI assistant that analyzes mathematical solutions."},
                        {"role": "user", "content": analysis_prompt}
                    ],
                    temperature=0.5,
                    max_tokens=4000
                )
                
                ai_response = response.choices[0].message.content
                logger.info("OpenAI API call successful via SDK")
            except Exception as e:
                logger.error(f"Both API call methods failed: {str(e)}")
                raise HTTPException(
                    status_code=500, 
                    detail="Failed to get a response from OpenAI API. Please try again later."
                )
        
        # Log first part of the response for debugging
        logger.info(f"AI response preview: {ai_response[:200]}...")
        
        # Parse the AI response
        analysis_result = parse_ai_response(ai_response)
        
        # Save the raw response for debugging
        with open(f"response_debug_{task_id}.txt", "w") as f:
            f.write(ai_response)
        
        # Validate the analysis result
        if not analysis_result["detailed_feedback"]["strengths"] and not analysis_result["detailed_feedback"]["weaknesses"]:
            logger.warning("Analysis result lacks both strengths and weaknesses")
            # Add a default strength if none were extracted
            analysis_result["detailed_feedback"]["strengths"] = ["Solution demonstrates some understanding of the mathematical concepts"]
        
        if not analysis_result["cell_annotations"]:
            logger.warning("Analysis result lacks cell annotations")
            # Try to extract some cell-level information from the weaknesses
            for weakness in analysis_result["detailed_feedback"]["weaknesses"]:
                cell_match = re.search(r'(?:cell|ячейка)\s*(\d+)', weakness, re.IGNORECASE)
                if cell_match:
                    cell_index = int(cell_match.group(1))
                    analysis_result["cell_annotations"].append({
                        "cell_index": cell_index,
                        "comments": [weakness]
                    })
        
        # Return the analysis result
        return AnalysisResult(
            error_summary=analysis_result["error_summary"],
            detailed_feedback=analysis_result["detailed_feedback"],
            confidence_score=analysis_result["confidence_score"],
            grade=analysis_result["grade"],
            cell_annotations=analysis_result["cell_annotations"],
            error_highlights=[]  # Empty for now, will be enhanced in future
        )
        
    except Exception as e:
        logger.error(f"Error analyzing notebooks: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Analysis failed: {str(e)}")

@app.get("/api/export-report/{task_id}")
async def export_report(task_id: str):
    """
    Export analysis results as an Excel file.
    This endpoint creates an Excel report with analysis data for a single user.
    All information is consolidated in a single sheet with feedback and cell annotations
    in compact cells with line breaks.
    """
    try:
        logger.info(f"Generating Excel report for task ID: {task_id}")
        
        # Create a single test user with their analysis result
        # In a real app, this would be fetched from a database
        test_user = {
            "student_id": "12345",
            "name": "Test",
            "email": "Test@example.com",
            "submission_date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "analysis_result": {
                "grade": 0,
                "confidence_score": 0.9,
                "error_summary": "Отсутствуют проверки размерности и обработка ошибок",
                "detailed_feedback": {
                    "strengths": [
                        "Корректное использование NumPy для матричных операций",
                        "Правильная реализация базовых матричных вычислений"
                    ],
                    "weaknesses": [
                        "Отсутствует или некорректная Проверка размерности матриц",
                        "Отсутствует или некорректная Проверка квадратности матрицы для определителя и обратной матрицы",
                        "Отсутствует или некорректная Проверка сингулярности для обратной матрицы",
                        "Отсутствует или некорректная Корректная обработка ошибок с возвратом None",
                        "Отсутствует или некорректная Эффективные векторизованные операции"
                    ],
                    "suggestions": [
                        "Добавьте корректную Проверка размерности матриц перед выполнением операций",
                        "Добавьте корректную Проверка квадратности матрицы для определителя и обратной матрицы перед выполнением операций",
                        "Добавьте корректную Проверка сингулярности для обратной матрицы перед выполнением операций",
                        "Добавьте корректную Корректная обработка ошибок с возвратом None перед выполнением операций"
                    ]
                },
                "cell_annotations": [
                    {
                        "cell_index": 3,
                        "comments": ["Отсутствует проверка размерности матриц перед умножением"]
                    },
                    {
                        "cell_index": 5,
                        "comments": ["Необходима проверка на квадратность матрицы перед вычислением определителя"]
                    },
                    {
                        "cell_index": 7,
                        "comments": ["Добавьте проверку на сингулярность перед вычислением обратной матрицы"]
                    }
                ],
                "error_highlights": []
            }
        }
        
        logger.info("Created test user data")
        
        # Create a BytesIO object to store the Excel file
        output = io.BytesIO()
        
        try:
            # Create a Pandas Excel writer using the BytesIO object
            logger.info("Creating Excel writer")
            with pd.ExcelWriter(output, engine='openpyxl') as writer:
                logger.info("Creating consolidated summary sheet")
                
                # Compile all feedback into a single formatted string
                feedback_str = ""
                
                # Add strengths
                feedback_str += "STRENGTHS:\n"
                for strength in test_user["analysis_result"]["detailed_feedback"]["strengths"]:
                    feedback_str += f"• {strength}\n"
                feedback_str += "\n"
                
                # Add weaknesses
                feedback_str += "WEAKNESSES:\n"
                for weakness in test_user["analysis_result"]["detailed_feedback"]["weaknesses"]:
                    feedback_str += f"• {weakness}\n"
                feedback_str += "\n"
                
                # Add suggestions
                feedback_str += "RECOMMENDATIONS:\n"
                for suggestion in test_user["analysis_result"]["detailed_feedback"]["suggestions"]:
                    feedback_str += f"• {suggestion}\n"
                
                # Compile all cell annotations into a single formatted string
                cells_str = "CELL ANNOTATIONS:\n"
                for annotation in test_user["analysis_result"]["cell_annotations"]:
                    cell_index = annotation["cell_index"]
                    for comment in annotation["comments"]:
                        cells_str += f"• Cell {cell_index}: {comment}\n"
                
                # Create main summary sheet with columns for student info and consolidated feedback
                summary_data = {
                    "student_id": [test_user["student_id"]],
                    "name": [test_user["name"]],
                    "email": [test_user["email"]],
                    "grade": [test_user["analysis_result"]["grade"]],
                    "confidence_score": [test_user["analysis_result"]["confidence_score"]],
                    "submission_date": [test_user["submission_date"]],
                    "error_count": [len(test_user["analysis_result"]["detailed_feedback"]["weaknesses"])],
                    "feedback": [feedback_str],
                    "cell_annotations": [cells_str]
                }
                
                # Convert to DataFrame
                summary_df = pd.DataFrame(summary_data)
                logger.info(f"Created consolidated DataFrame with {len(summary_df.columns)} columns")
                
                # Add statistical information
                avg_grade = test_user["analysis_result"]["grade"]
                min_grade = test_user["analysis_result"]["grade"]
                max_grade = test_user["analysis_result"]["grade"]
                
                # Write summary to Excel sheet - use English sheet name as requested
                summary_df.to_excel(writer, sheet_name="Summary", index=False)
                logger.info("Wrote summary data to Excel")
                
                try:
                    # Format the worksheet
                    worksheet = writer.sheets["Summary"]
                    
                    # Make the headers bold and format the columns
                    for col_num, value in enumerate(summary_df.columns.values):
                        worksheet.cell(row=1, column=col_num+1).style = 'Headline 1'
                    
                    # Adjust column widths for better readability
                    worksheet.column_dimensions['H'].width = 80  # feedback column
                    worksheet.column_dimensions['I'].width = 50  # cell annotations column
                    
                    # Enable text wrapping for feedback and cell annotations
                    for row in range(2, worksheet.max_row + 1):
                        feedback_cell = worksheet.cell(row=row, column=8)  # H column
                        feedback_cell.alignment = openpyxl.styles.Alignment(wrap_text=True, vertical='top')
                        
                        cells_cell = worksheet.cell(row=row, column=9)  # I column
                        cells_cell.alignment = openpyxl.styles.Alignment(wrap_text=True, vertical='top')
                        
                        # Set row height to accommodate wrapped text
                        worksheet.row_dimensions[row].height = 150
                    
                    # Add statistics at the bottom
                    stats_row = len(summary_df) + 3
                    worksheet.cell(row=stats_row, column=1).value = "Statistics"
                    worksheet.cell(row=stats_row, column=1).style = 'Headline 1'
                    
                    worksheet.cell(row=stats_row+1, column=1).value = "Average Grade"
                    worksheet.cell(row=stats_row+1, column=2).value = avg_grade
                    
                    worksheet.cell(row=stats_row+2, column=1).value = "Minimum Grade"
                    worksheet.cell(row=stats_row+2, column=2).value = min_grade
                    
                    worksheet.cell(row=stats_row+3, column=1).value = "Maximum Grade"
                    worksheet.cell(row=stats_row+3, column=2).value = max_grade
                    logger.info("Formatted summary sheet")
                except Exception as format_error:
                    logger.error(f"Error formatting summary sheet: {str(format_error)}")
                    # Continue without formatting
                
                logger.info("Excel file creation completed successfully")
        except Exception as excel_err:
            logger.error(f"Error creating Excel file: {str(excel_err)}")
            raise Exception(f"Failed to create Excel document: {str(excel_err)}")
        
        # Get the content of the Excel file
        output.seek(0)
        excel_data = output.getvalue()
        
        if len(excel_data) < 100:
            logger.error(f"Excel data size too small: {len(excel_data)} bytes")
            raise Exception("Generated Excel file is too small, likely corrupt")
        
        # Return the Excel file for download
        filename = f"proofmate_report_{task_id}.xlsx"
        
        headers = {
            'Content-Disposition': f'attachment; filename="{filename}"',
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        }
        
        logger.info(f"Excel report generated successfully for task ID: {task_id}")
        return Response(content=excel_data, headers=headers)
        
    except Exception as e:
        logger.error(f"Error generating Excel report for task ID {task_id}: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Error generating report: {str(e)}")

if __name__ == "__main__":
    port = int(os.environ.get("PYTHON_SERVER_PORT", 8000))
    uvicorn.run("main_functional:app", host="0.0.0.0", port=port, reload=True) 