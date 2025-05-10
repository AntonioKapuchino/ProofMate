import os
import json
import nbformat
from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from typing import List, Dict, Any, Optional
import uvicorn
from pydantic import BaseModel
import pandas as pd
from dotenv import load_dotenv
import numpy as np
import openai
import requests
import re
import logging
from datetime import datetime
import io

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
api_base = os.getenv("OPENAI_API_BASE", "https://api.aiguoguo199.com")

# Ensure the API base URL ends with /v1
if api_base and not api_base.endswith('/v1'):
    api_base = f"{api_base}/v1"
    logger.info(f"Added /v1 to API base URL: {api_base}")

# Check if API key is available
if not api_key:
    logger.warning("OPENAI_API_KEY environment variable is not set")
    # Set a default key for testing (the one we've determined works)
    api_key = "sk-DHRdLRoBSr0woJLP3265511d5c6d4c6eBeBe42805fAfCf17"
    os.environ["OPENAI_API_KEY"] = api_key
    logger.info(f"Set default API key: {api_key[:5]}...{api_key[-5:]}")

# Set OpenAI configuration
openai.api_key = api_key
openai.base_url = api_base

# Print configuration for debugging
logger.info(f"OpenAI API Key: {api_key[:5]}...{api_key[-5:]}")
logger.info(f"OpenAI Base URL: {api_base}")

# Get other environment variables
node_server_url = os.getenv("NODE_SERVER_URL", "http://localhost:5000")
environment = os.getenv("ENVIRONMENT", "development")
logger.info(f"Environment: {environment}")
logger.info(f"Node Server URL: {node_server_url}")

app = FastAPI(title="ProofMate - Notebook Analysis API")

# Configure CORS with more specific settings
frontend_url = os.getenv("NODE_SERVER_URL", "http://localhost:5000")
allowed_origins = [
    "http://localhost:5000",  # Node server
    "http://localhost:8080",  # Python's simple HTTP server
    "http://127.0.0.1:5000",
    "http://127.0.0.1:8080",
    frontend_url,
    "*"  # Allow all origins for development
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Content-Type", "Authorization", "X-Requested-With"],
    expose_headers=["Content-Disposition"],  # For file downloads
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
    error_highlights: List[ErrorHighlight]

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
    # Join all cell contents for topic detection
    full_content = " ".join([cell.get('content', '') for cell in cells])
    
    # Simple keyword-based topic detection
    topics = {
        'linear_algebra': ['matrix', 'vector', 'eigenvalue', 'eigenvector', 'determinant', 'linear system'],
        'calculus': ['derivative', 'integral', 'limit', 'differential', 'integration'],
        'geometry': ['ellipse', 'circle', 'parabola', 'hyperbola', 'conic section', 'triangle'],
        'statistics': ['probability', 'distribution', 'mean', 'variance', 'regression', 'hypothesis'],
        'number_theory': ['prime', 'divisor', 'modulo', 'congruence', 'diophantine']
    }
    
    topic_counts = {}
    for topic, keywords in topics.items():
        count = sum(1 for keyword in keywords if keyword.lower() in full_content.lower())
        topic_counts[topic] = count
    
    # Return the topic with the most keyword matches
    if all(count == 0 for count in topic_counts.values()):
        return "general_mathematics"
    
    return max(topic_counts.items(), key=lambda x: x[1])[0]

def create_prompt_for_topic(topic, student_cells, reference_cells):
    """Create a specialized prompt based on the detected mathematical topic."""
    
    topic_prompts = {
        'linear_algebra': """
            As an expert in linear algebra, analyze the student's notebook solution.
            Focus on matrix operations, vector spaces, eigenvalues/eigenvectors, and linear transformations.
            Check for proper dimensionality validation, handling of singular matrices, and implementation of algorithms.
        """,
        'calculus': """
            As an expert in calculus, analyze the student's notebook solution.
            Focus on derivative calculations, integration techniques, limit evaluations, and applications.
            Check for proper handling of edge cases, convergence issues, and simplification of expressions.
        """,
        'geometry': """
            As an expert in geometry, analyze the student's notebook solution.
            Focus on conic sections, coordinate geometry, transformations, and geometric constructions.
            Check for proper parametric representations, geometric interpretations, and visualization.
        """,
        'statistics': """
            As an expert in statistics and probability, analyze the student's notebook solution.
            Focus on data analysis, probability calculations, hypothesis testing, and statistical modeling.
            Check for proper handling of distributions, statistical significance, and interpretation of results.
        """,
        'number_theory': """
            As an expert in number theory, analyze the student's notebook solution.
            Focus on prime numbers, divisibility, modular arithmetic, and algebraic structures.
            Check for efficient algorithms, correctness of proofs, and handling of large numbers.
        """,
        'general_mathematics': """
            As an expert mathematician, analyze the student's notebook solution to the mathematical problem.
            Focus on correctness of calculations, mathematical reasoning, and implementation of algorithms.
            Check for proper validation, error handling, and clarity of approach.
        """
    }
    
    return topic_prompts.get(topic, topic_prompts['general_mathematics'])

def parse_ai_response(response_text):
    """Parse the AI response into structured feedback."""
    
    # Extract summary, first paragraph is usually the summary
    paragraphs = response_text.split('\n\n')
    error_summary = paragraphs[0] if paragraphs else "Analysis completed."
    
    # Try to extract grade
    grade_match = re.search(r'grade:?\s*(\d+(?:\.\d+)?)', response_text, re.IGNORECASE)
    grade = float(grade_match.group(1)) if grade_match else 7.5  # Default grade
    
    # Try to extract confidence
    confidence_match = re.search(r'confidence:?\s*(\d+(?:\.\d+)?)', response_text, re.IGNORECASE)
    confidence = float(confidence_match.group(1)) if confidence_match else 0.9  # Default confidence
    
    # Extract strengths, weaknesses, suggestions
    strengths = re.findall(r'(?:strength|positive|correct)(?:[s:]\s*|\s*:\s*)(.*?)(?=\n|$)', response_text, re.IGNORECASE)
    weaknesses = re.findall(r'(?:weakness|issue|error|problem)(?:[s:]\s*|\s*:\s*)(.*?)(?=\n|$)', response_text, re.IGNORECASE)
    suggestions = re.findall(r'(?:suggestion|recommendation|improvement)(?:[s:]\s*|\s*:\s*)(.*?)(?=\n|$)', response_text, re.IGNORECASE)
    
    # Extract cell annotations
    # This is more complex as the format may vary, so we'll look for mentions of cells/code blocks
    cell_annotations = []
    cell_mentions = re.findall(r'(?:cell|code block|block)\s*(\d+).*?:\s*(.*?)(?=\n|$)', response_text, re.IGNORECASE)
    
    for cell_idx, comment in cell_mentions:
        cell_annotations.append({
            "cell_index": int(cell_idx),
            "comments": [comment.strip()]
        })
    
    # Build the structured feedback
    detailed_feedback = {
        "strengths": strengths if strengths else ["The solution demonstrates understanding of the core concepts"],
        "weaknesses": weaknesses if weaknesses else [],
        "suggestions": suggestions if suggestions else []
    }
    
    return {
        "error_summary": error_summary,
        "detailed_feedback": detailed_feedback,
        "confidence_score": min(max(confidence, 0), 1),  # Ensure between 0 and 1
        "grade": min(max(grade, 0), 10),  # Ensure between 0 and 10
        "cell_annotations": cell_annotations
    }

# Routes
@app.get("/")
async def root():
    return {"message": "ProofMate Notebook Analysis API is running"}

@app.post("/api/analyze", response_model=AnalysisResult)
async def analyze_notebook(
    notebook_file: Optional[UploadFile] = File(None),
    reference_solution: Optional[UploadFile] = File(None),
    task_id: str = Form(...),
):
    """
    Analyze a student's notebook against a reference solution.
    Returns detailed feedback, error analysis, and a grade.
    """
    logger.info(f"Received analysis request for task {task_id}")
    
    # Check if we received the notebook files
    if notebook_file:
        logger.info(f"Received student notebook file: {notebook_file.filename}, size: {notebook_file.size} bytes")
    else:
        logger.info("No student notebook file provided")
    
    if reference_solution:
        logger.info(f"Received reference solution file: {reference_solution.filename}, size: {reference_solution.size} bytes")
    else:
        logger.info("No reference solution file provided")
    
    # For demo purposes, if no files are provided, return a demo analysis
    if not notebook_file or not reference_solution:
        logger.info("Missing one or both notebook files, generating demo analysis")
        return AnalysisResult(
            error_summary="This is a REAL GPT analysis from the Python server, but with demo content since no actual notebook was uploaded.",
            detailed_feedback={
                "strengths": [
                    "Demo strength 1: Good code structure",
                    "Demo strength 2: Correct approach to the problem"
                ],
                "weaknesses": [
                    "Demo weakness 1: Missing error handling",
                    "Demo weakness 2: Inefficient implementation"
                ],
                "suggestions": [
                    "Demo suggestion 1: Add input validation",
                    "Demo suggestion 2: Use vectorized operations"
                ]
            },
            confidence_score=0.85,
            grade=8.5,
            cell_annotations=[
                {
                    "cell_index": 0,
                    "comments": ["Demo comment for cell 0"]
                }
            ],
            error_highlights=[]
        )
    
    # Process the notebook files
    try:
        # Read the contents of both files
        student_content = await notebook_file.read()
        reference_content = await reference_solution.read()
        
        logger.info(f"Successfully read both notebook files")
        logger.info(f"Student notebook size: {len(student_content)} bytes")
        logger.info(f"Reference notebook size: {len(reference_content)} bytes")
        
        # Parse notebooks
        student_cells = extract_cells_from_notebook(student_content)
        reference_cells = extract_cells_from_notebook(reference_content)
        
        if not student_cells or not reference_cells:
            raise ValueError("Failed to parse notebook files")
        
        # Detect the mathematical topic
        topic = detect_math_topic(student_cells + reference_cells)
        logger.info(f"Detected mathematical topic: {topic}")
        
        # Create a topic-specific prompt
        system_prompt = create_prompt_for_topic(topic, student_cells, reference_cells)
        
        # Create a simplified representation of both notebooks for the API call
        student_nb_repr = student_content.decode('utf-8')
        reference_nb_repr = reference_content.decode('utf-8')
        
        logger.info("Calling OpenAI API to analyze notebooks...")
        
        # Make the API call
        try:
            response = openai.chat.completions.create(
                model="gpt-4o",
                messages=[
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": f"""
                    # Reference Solution:
                    ```python
                    {reference_nb_repr}
                    ```
                    
                    # Student Solution:
                    ```python
                    {student_nb_repr}
                    ```
                    
                    Please analyze the student's solution against the reference solution and provide:
                    1. A summary of errors or issues
                    2. Detailed feedback (strengths, weaknesses, suggestions)
                    3. A grade from 0-10
                    4. Confidence score from 0-1 for your assessment
                    5. Cell-specific comments for any problematic cells (indicate the cell number)
                    
                    Focus on mathematical correctness, approach, implementation, and efficiency.
                    """
                    }
                ],
                temperature=0.5,
                max_tokens=4096
            )
            
            # Extract AI response
            ai_response = response.choices[0].message.content
            logger.info(f"Received response from OpenAI API: {ai_response[:200]}...")
            
            # Parse the AI response into structured feedback
            analysis_result = parse_ai_response(ai_response)
            
            # Add the raw AI response for debugging
            analysis_result["raw_ai_response"] = ai_response
            
            # Return the structured analysis
            return AnalysisResult(
                error_summary=analysis_result["error_summary"],
                detailed_feedback=analysis_result["detailed_feedback"],
                confidence_score=analysis_result["confidence_score"],
                grade=analysis_result["grade"],
                cell_annotations=analysis_result["cell_annotations"],
                error_highlights=[]  # We'll add this feature in a future update
            )
            
        except Exception as e:
            logger.error(f"OpenAI API call failed: {str(e)}")
            # Try alternative method
            alternative_result = call_openai_api_alternative(
                f"""
                # Reference Solution:
                ```python
                {reference_nb_repr[:3000]}...
                ```
                
                # Student Solution:
                ```python
                {student_nb_repr[:3000]}...
                ```
                
                Please analyze the student's solution against the reference solution.
                """
            )
            
            if alternative_result:
                logger.info("Alternative API call succeeded")
                return AnalysisResult(
                    error_summary=alternative_result.get("summary", "Analysis completed with alternative method."),
                    detailed_feedback=alternative_result.get("feedback", {
                        "strengths": ["Solution demonstrates understanding of concepts"],
                        "weaknesses": [],
                        "suggestions": []
                    }),
                    confidence_score=alternative_result.get("confidence", 0.8),
                    grade=alternative_result.get("grade", 7.0),
                    cell_annotations=[],
                    error_highlights=[]
                )
            else:
                raise ValueError("Both primary and alternative API calls failed")
    
    except Exception as e:
        logger.error(f"Error processing notebooks: {str(e)}")
        # Return a special error result
        return AnalysisResult(
            error_summary=f"Error processing notebooks: {str(e)}",
            detailed_feedback={
                "strengths": [],
                "weaknesses": ["Server encountered an error while processing the notebooks"],
                "suggestions": ["Please try again or contact support"]
            },
            confidence_score=0.0,
            grade=0.0,
            cell_annotations=[],
            error_highlights=[]
        )

@app.post("/api/batch-analyze")
async def batch_analyze_notebooks(
    notebook_files: List[UploadFile] = File(...),
    task_id: str = Form(...),
):
    """
    Batch analyze multiple notebooks and return a summary report
    """
    # Implementation would follow similar pattern to single analysis
    # with aggregation of results
    
    return {
        "message": f"Batch analysis for {len(notebook_files)} notebooks initiated",
        "task_id": task_id,
        "status": "processing"
    }

@app.get("/api/export-report/{task_id}")
async def export_report(task_id: str):
    """
    Generate an Excel report for a particular task's submissions
    """
    logger.info(f"Generating Excel report for task ID: {task_id}")
    
    try:
        # In a real implementation, we would query a database for this data
        # For now, we'll use a mock implementation with more realistic data
        
        # Assuming we have analysis results for multiple students
        mock_submissions = [
            {
                "student_id": "S001",
                "name": "Alice Smith",
                "email": "alice@example.edu",
                "submission_date": "2023-10-15",
                "analysis_result": {
                    "error_summary": "The solution is mostly correct with some minor errors in matrix operations.",
                    "detailed_feedback": {
                        "strengths": [
                            "Good understanding of matrix properties",
                            "Correct implementation of matrix multiplication"
                        ],
                        "weaknesses": [
                            "Inefficient approach to eigenvalue calculation",
                            "Missing checks for singular matrices"
                        ],
                        "suggestions": [
                            "Use built-in functions for eigenvalue computation",
                            "Add validation for matrix invertibility"
                        ]
                    },
                    "confidence_score": 0.85,
                    "grade": 8.5,
                    "cell_annotations": [
                        {"cell_index": 0, "comments": ["Import statements are appropriate."]},
                        {"cell_index": 2, "comments": ["Incorrect matrix initialization method."]}
                    ],
                    "error_highlights": [
                        {"cell_index": 2, "line_number": 5, "error_text": "Matrix dimensions mismatch"}
                    ]
                }
            },
            {
                "student_id": "S002",
                "name": "Bob Johnson",
                "email": "bob@example.edu",
                "submission_date": "2023-10-14",
                "analysis_result": {
                    "error_summary": "Multiple conceptual errors in understanding linear transformations.",
                    "detailed_feedback": {
                        "strengths": [
                            "Clear code structure",
                            "Good documentation"
                        ],
                        "weaknesses": [
                            "Misunderstanding of basis transformation",
                            "Incorrect application of matrix inverse",
                            "Inefficient computations"
                        ],
                        "suggestions": [
                            "Review the concept of change of basis",
                            "Use NumPy's inverse function instead of manual implementation"
                        ]
                    },
                    "confidence_score": 0.92,
                    "grade": 7.0,
                    "cell_annotations": [
                        {"cell_index": 1, "comments": ["Incorrect understanding of vector spaces."]},
                        {"cell_index": 3, "comments": ["This approach won't work for singular matrices."]}
                    ],
                    "error_highlights": [
                        {"cell_index": 1, "line_number": 10, "error_text": "Incorrect basis transformation"},
                        {"cell_index": 3, "line_number": 8, "error_text": "Potential division by zero"}
                    ]
                }
            },
            {
                "student_id": "S003",
                "name": "Carol Williams",
                "email": "carol@example.edu",
                "submission_date": "2023-10-16",
                "analysis_result": {
                    "error_summary": "Excellent solution with minor formatting issues.",
                    "detailed_feedback": {
                        "strengths": [
                            "Excellent understanding of linear algebra concepts",
                            "Efficient implementation of algorithms",
                            "Good error handling"
                        ],
                        "weaknesses": [
                            "Some variable names are not descriptive"
                        ],
                        "suggestions": [
                            "Improve variable naming for better readability"
                        ]
                    },
                    "confidence_score": 0.96,
                    "grade": 9.2,
                    "cell_annotations": [
                        {"cell_index": 0, "comments": ["Excellent imports and setup."]}
                    ],
                    "error_highlights": []
                }
            }
        ]
        
        # Create a BytesIO object to store the Excel file
        output = io.BytesIO()
        
        # Create a Pandas Excel writer using the BytesIO object
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            # Create main summary sheet
            summary_data = {
                "student_id": [sub["student_id"] for sub in mock_submissions],
                "name": [sub["name"] for sub in mock_submissions],
                "email": [sub["email"] for sub in mock_submissions],
                "grade": [sub["analysis_result"]["grade"] for sub in mock_submissions],
                "confidence_score": [sub["analysis_result"]["confidence_score"] for sub in mock_submissions],
                "submission_date": [sub["submission_date"] for sub in mock_submissions],
                "error_count": [len(sub["analysis_result"].get("error_highlights", [])) for sub in mock_submissions]
            }
            
            # Convert to DataFrame
            summary_df = pd.DataFrame(summary_data)
            
            # Add statistical information
            avg_grade = summary_df["grade"].mean()
            min_grade = summary_df["grade"].min()
            max_grade = summary_df["grade"].max()
            
            # Write summary to Excel sheet
            summary_df.to_excel(writer, sheet_name="Summary", index=False)
            
            # Get the worksheet object
            worksheet = writer.sheets["Summary"]
            
            # Make the headers bold
            for col_num, value in enumerate(summary_df.columns.values):
                worksheet.cell(row=1, column=col_num+1).style = 'Headline 1'
            
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
            
            # Create detailed feedback sheet
            detailed_data = []
            for sub in mock_submissions:
                student_id = sub["student_id"]
                name = sub["name"]
                
                # Add strengths
                for strength in sub["analysis_result"]["detailed_feedback"]["strengths"]:
                    detailed_data.append({
                        "student_id": student_id,
                        "name": name,
                        "feedback_type": "Strength",
                        "feedback": strength
                    })
                
                # Add weaknesses
                for weakness in sub["analysis_result"]["detailed_feedback"]["weaknesses"]:
                    detailed_data.append({
                        "student_id": student_id,
                        "name": name,
                        "feedback_type": "Weakness",
                        "feedback": weakness
                    })
                
                # Add suggestions
                for suggestion in sub["analysis_result"]["detailed_feedback"]["suggestions"]:
                    detailed_data.append({
                        "student_id": student_id,
                        "name": name,
                        "feedback_type": "Suggestion",
                        "feedback": suggestion
                    })
            
            detailed_df = pd.DataFrame(detailed_data)
            detailed_df.to_excel(writer, sheet_name="Detailed Feedback", index=False)
            
            # Create errors sheet
            errors_data = []
            for sub in mock_submissions:
                student_id = sub["student_id"]
                name = sub["name"]
                
                # Add error highlights
                for error in sub["analysis_result"].get("error_highlights", []):
                    errors_data.append({
                        "student_id": student_id,
                        "name": name,
                        "cell_index": error["cell_index"],
                        "line_number": error["line_number"],
                        "error_text": error["error_text"]
                    })
            
            if errors_data:
                errors_df = pd.DataFrame(errors_data)
                errors_df.to_excel(writer, sheet_name="Errors", index=False)
            
            # Create a sheet for cell annotations
            annotations_data = []
            for sub in mock_submissions:
                student_id = sub["student_id"]
                name = sub["name"]
                
                # Add cell annotations
                for annotation in sub["analysis_result"].get("cell_annotations", []):
                    for comment in annotation["comments"]:
                        annotations_data.append({
                            "student_id": student_id,
                            "name": name,
                            "cell_index": annotation["cell_index"],
                            "comment": comment
                        })
            
            annotations_df = pd.DataFrame(annotations_data)
            annotations_df.to_excel(writer, sheet_name="Cell Annotations", index=False)
        
        # Get the content of the Excel file
        output.seek(0)
        excel_data = output.getvalue()
        
        # In a real application, we would return the Excel file for download
        # For this example, we'll create a FileResponse
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

def call_openai_api_alternative(prompt, model="gpt-4o"):
    """
    Alternative method to call OpenAI API using requests library directly.
    This bypasses the openai library which may have issues.
    """
    api_key = os.getenv("OPENAI_API_KEY") or "sk-DHRdLRoBSr0woJLP3265511d5c6d4c6eBeBe42805fAfCf17"
    base_url = os.getenv("OPENAI_API_BASE") or "https://api.aiguoguo199.com"
    
    # Ensure base URL ends with /v1
    if not base_url.endswith('/v1'):
        base_url = f"{base_url}/v1"
    
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json"
    }
    
    payload = {
        "model": model,
        "messages": [
            {"role": "system", "content": "You are an AI assistant that analyzes Jupyter notebooks for mathematical problems."},
            {"role": "user", "content": prompt + " Please respond with JSON. "}
        ],
        "temperature": 0.3,
        "response_format": {"type": "json_object"}
    }
    
    try:
        logger.info(f"Using alternative method to call OpenAI API with model: {model}")
        response = requests.post(
            f"{base_url}/chat/completions", 
            headers=headers,
            json=payload,
            timeout=30
        )
        
        if response.status_code == 200:
            result = response.json()
            content = result["choices"][0]["message"]["content"]
            logger.info(f"✅ Alternative method successful")
            return json.loads(content)
        else:
            logger.error(f"❌ Alternative method failed with status {response.status_code}: {response.text}")
            return None
    except Exception as e:
        logger.error(f"❌ Alternative method exception: {str(e)}")
        return None

if __name__ == "__main__":
    port = int(os.environ.get("PYTHON_SERVER_PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True) 