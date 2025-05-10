import os
import json
import uuid
import logging
import requests
import io
import nbformat
import numpy as np
import pandas as pd
from typing import Dict, List, Any, Optional
from fastapi import FastAPI, File, Form, UploadFile, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import uvicorn
import openai
from fastapi.responses import JSONResponse

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler('python_server_log.txt')
    ]
)
logger = logging.getLogger('proofmate')

# Load environment variables
load_dotenv()

# Configure OpenAI API
api_key = os.getenv("OPENAI_API_KEY")
api_base = os.getenv("OPENAI_API_BASE")
environment = os.getenv("ENVIRONMENT", "development")
node_server_url = os.getenv("NODE_SERVER_URL")

# Add /v1 to API base URL if it doesn't end with it
if api_base and not api_base.endswith('/v1'):
    api_base = f"{api_base}/v1"
    logger.info(f"Added /v1 to API base URL: {api_base}")
elif not api_base:
    api_base = "https://api.aiguoguo199.com/v1"
    logger.info(f"Using default API base URL: {api_base}")

# Configure OpenAI client
openai.api_key = api_key
if api_base:
    openai.base_url = api_base

# Log configuration (hide most of API key for security)
if api_key:
    hidden_key = f"{api_key[:4]}...{api_key[-4:]}"
    logger.info(f"OpenAI API Key: {hidden_key}")
if api_base:
    logger.info(f"OpenAI Base URL: {api_base}")
logger.info(f"Environment: {environment}")
logger.info(f"Node Server URL: {node_server_url}")

app = FastAPI()

# Add CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # In production, replace with specific origins
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Analysis result model
class AnalysisResult(BaseModel):
    error_summary: str
    detailed_feedback: Dict[str, List[str]]
    confidence_score: float
    grade: float
    cell_annotations: List[Dict[str, Any]]
    error_highlights: List[Dict[str, Any]] = []

# Helper function to read notebook file
def read_notebook_file(file: UploadFile) -> Dict[str, Any]:
    try:
        contents = file.file.read()
        file.file.seek(0)  # Reset file pointer for potential future reads
        
        # Parse the notebook
        notebook = nbformat.reads(contents.decode('utf-8'), as_version=4)
        return notebook
    except Exception as e:
        logger.error(f"Error reading notebook file: {str(e)}")
        raise HTTPException(status_code=400, detail=f"Invalid notebook file: {str(e)}")

# Helper function to extract code cells from notebook
def extract_code_cells(notebook: Dict[str, Any]) -> List[str]:
    code_cells = []
    for cell in notebook.cells:
        if cell.cell_type == 'code':
            code_cells.append(cell.source)
    return code_cells

# Helper function to detect mathematical topics
def detect_topic(notebook: Dict[str, Any]) -> str:
    text_content = ""
    
    # Extract all text from the notebook
    for cell in notebook.cells:
        text_content += cell.source + "\n"
    
    # Check for keywords related to different topics
    text_content = text_content.lower()
    
    if any(kw in text_content for kw in ["matrix", "vector", "determinant", "eigenvalue", "linear system", "transformation", "basis", "span", "subspace", "orthogonal", "projection"]):
        return "linear_algebra"
    elif any(kw in text_content for kw in ["ellipse", "parabola", "hyperbola", "conic", "focus", "directrix", "eccentricity"]):
        return "analytic_geometry"
    elif any(kw in text_content for kw in ["derivative", "integral", "limit", "continuous", "differentiable", "extrema", "convergence", "series"]):
        return "calculus"
    elif any(kw in text_content for kw in ["probability", "random", "distribution", "expectation", "variance", "bayes", "hypothesis", "confidence"]):
        return "probability"
    elif any(kw in text_content for kw in ["graph", "vertex", "edge", "tree", "path", "connectivity", "cycle", "traversal"]):
        return "graph_theory"
    else:
        return "general_mathematics"

# Helper function to extract custom error markers
def extract_error_markers(notebook: Dict[str, Any]) -> List[Dict[str, Any]]:
    error_markers = []
    cell_index = 0
    
    for cell in notebook.cells:
        if "ОШИБКА" in cell.source or "ERROR" in cell.source:
            error_description = cell.source
            error_markers.append({
                "cell_index": cell_index,
                "error_description": error_description
            })
        cell_index += 1
        
    return error_markers

@app.get("/")
def read_root():
    return {"message": "ProofMate API Server is running"}

@app.get("/healthcheck")
def healthcheck():
    return {"status": "ok", "environment": environment}

# Utility function to create Excel report from analysis results
def create_excel_report(task_id: str, submissions_data: List[Dict[str, Any]]):
    """
    Create an Excel report from analysis results
    
    Args:
        task_id: The ID of the task/assignment
        submissions_data: List of submissions with analysis results
        
    Returns:
        BytesIO object containing the Excel file
    """
    logger.info(f"Creating Excel report for task ID: {task_id} with {len(submissions_data)} submissions")
    
    # Create a BytesIO object to store the Excel file
    output = io.BytesIO()
    
    try:
        # Create a Pandas Excel writer using the BytesIO object
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            # Create main summary sheet
            summary_data = {
                "student_id": [],
                "name": [],
                "email": [],
                "grade": [],
                "confidence_score": [],
                "submission_date": [],
                "error_count": []
            }
            
            # Extract summary data from each submission
            for sub in submissions_data:
                summary_data["student_id"].append(sub.get("student_id", "Unknown"))
                summary_data["name"].append(sub.get("name", "Unknown"))
                summary_data["email"].append(sub.get("email", ""))
                
                analysis_result = sub.get("analysis_result", {})
                summary_data["grade"].append(analysis_result.get("grade", 0.0))
                summary_data["confidence_score"].append(analysis_result.get("confidence_score", 0.0))
                summary_data["submission_date"].append(sub.get("submission_date", ""))
                summary_data["error_count"].append(len(analysis_result.get("error_highlights", [])))
            
            # Convert to DataFrame
            summary_df = pd.DataFrame(summary_data)
            
            # Add statistical information if we have grades
            if not summary_df.empty and "grade" in summary_df:
                avg_grade = summary_df["grade"].mean()
                min_grade = summary_df["grade"].min()
                max_grade = summary_df["grade"].max()
            else:
                avg_grade = min_grade = max_grade = 0.0
            
            # Write summary to Excel sheet
            summary_df.to_excel(writer, sheet_name="Summary", index=False)
            
            # Format the summary sheet
            worksheet = writer.sheets["Summary"]
            
            # Make the headers bold if openpyxl is available
            try:
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
            except Exception as e:
                logger.warning(f"Failed to apply formatting to Excel: {str(e)}")
            
            # Create detailed feedback sheet
            detailed_data = []
            for sub in submissions_data:
                student_id = sub.get("student_id", "Unknown")
                name = sub.get("name", "Unknown")
                
                analysis_result = sub.get("analysis_result", {})
                detailed_feedback = analysis_result.get("detailed_feedback", {})
                
                # Add strengths
                for strength in detailed_feedback.get("strengths", []):
                    detailed_data.append({
                        "student_id": student_id,
                        "name": name,
                        "feedback_type": "Strength",
                        "feedback": strength
                    })
                
                # Add weaknesses
                for weakness in detailed_feedback.get("weaknesses", []):
                    detailed_data.append({
                        "student_id": student_id,
                        "name": name,
                        "feedback_type": "Weakness",
                        "feedback": weakness
                    })
                
                # Add suggestions
                for suggestion in detailed_feedback.get("suggestions", []):
                    detailed_data.append({
                        "student_id": student_id,
                        "name": name,
                        "feedback_type": "Suggestion",
                        "feedback": suggestion
                    })
            
            if detailed_data:
                detailed_df = pd.DataFrame(detailed_data)
                detailed_df.to_excel(writer, sheet_name="Detailed Feedback", index=False)
            
            # Create errors sheet
            errors_data = []
            for sub in submissions_data:
                student_id = sub.get("student_id", "Unknown")
                name = sub.get("name", "Unknown")
                
                analysis_result = sub.get("analysis_result", {})
                
                # Add error highlights
                for error in analysis_result.get("error_highlights", []):
                    errors_data.append({
                        "student_id": student_id,
                        "name": name,
                        "cell_index": error.get("cell_index", 0),
                        "line_number": error.get("line_number", 0),
                        "error_text": error.get("error_text", "Unknown error")
                    })
            
            if errors_data:
                errors_df = pd.DataFrame(errors_data)
                errors_df.to_excel(writer, sheet_name="Errors", index=False)
            
            # Create a sheet for cell annotations
            annotations_data = []
            for sub in submissions_data:
                student_id = sub.get("student_id", "Unknown")
                name = sub.get("name", "Unknown")
                
                analysis_result = sub.get("analysis_result", {})
                
                # Add cell annotations
                for annotation in analysis_result.get("cell_annotations", []):
                    for comment in annotation.get("comments", []):
                        annotations_data.append({
                            "student_id": student_id,
                            "name": name,
                            "cell_index": annotation.get("cell_index", 0),
                            "comment": comment
                        })
            
            if annotations_data:
                annotations_df = pd.DataFrame(annotations_data)
                annotations_df.to_excel(writer, sheet_name="Cell Annotations", index=False)
        
        # Get the content of the Excel file
        output.seek(0)
        return output
    
    except Exception as e:
        logger.error(f"Error creating Excel report: {str(e)}")
        raise e

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
        
        # Use our utility function to create the Excel report
        output = create_excel_report(task_id, mock_submissions)
        excel_data = output.getvalue()
        
        # Create a response with the Excel file
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

# API endpoint to analyze single notebook against reference solution
@app.post("/api/analyze")
async def analyze_notebooks(
    notebook_file: UploadFile = File(...),
    reference_solution: UploadFile = File(...),
    task_id: str = Form(...)
):
    logger.info(f"Received analysis request for task {task_id}")
    logger.info(f"Received student notebook file: {notebook_file.filename}, size: {notebook_file.size} bytes")
    logger.info(f"Received reference solution file: {reference_solution.filename}, size: {reference_solution.size} bytes")
    
    # Read the notebook files
    try:
        student_nb = read_notebook_file(notebook_file)
        reference_nb = read_notebook_file(reference_solution)
        logger.info("Successfully read both notebook files")
        logger.info(f"Student notebook size: {notebook_file.size} bytes")
        logger.info(f"Reference notebook size: {reference_solution.size} bytes")
    except Exception as e:
        logger.error(f"Error reading notebook files: {str(e)}")
        raise HTTPException(status_code=400, detail=str(e))
    
    # Detect topic
    topic = detect_topic(student_nb)
    logger.info(f"Detected mathematical topic: {topic}")
    
    # Extract error markers if present (for better analysis)
    error_markers = extract_error_markers(student_nb)
    
    # Convert notebooks to string representation
    student_nb_repr = json.dumps(student_nb, indent=2)
    reference_nb_repr = json.dumps(reference_nb, indent=2)
    
    # Create system prompt based on topic
    system_prompt = f"""You are an expert mathematics professor specializing in {topic}. 
Your task is to analyze a student's solution to a mathematical problem. 
Be very detailed and thorough in your analysis, focusing on:
1. Mathematical correctness and conceptual understanding
2. Implementation correctness and efficiency 
3. Identifying specific errors and misconceptions
4. Providing constructive feedback and suggestions

When you see an error:
- Identify the specific type of error (mathematical, logical, implementation)
- Explain why it's wrong and how it should be corrected
- Rate the severity of the error

Pay special attention to any error markers in the student code (lines containing 'ОШИБКА' or 'ERROR').
These are intentional errors that should be identified and explained thoroughly.

Format your response as a JSON object with these fields:
- summary: A concise overview of the student's work
- feedback: Object with strengths, weaknesses, and suggestions arrays
- grade: A score from 0-10 based on mathematical correctness and implementation
- confidence: Your confidence in this assessment (0.0-1.0)
- annotations: Array of objects with cell_index and comments for specific cells
"""
    
    # Process notebooks and generate analysis
    try:
        logger.info("Calling OpenAI API to analyze notebooks...")
        
        try:
            # Try the standard OpenAI API call first
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
                    5. Cell-specific comments for any problematic cells
                    
                    {"I've noticed there may be some intentional errors marked with 'ОШИБКА' or 'ERROR' in the student solution. Please analyze these carefully." if error_markers else ""}
                    
                    Focus on mathematical correctness, approach, implementation, and efficiency.
                    """
                    }
                ],
                temperature=0.3,
                max_tokens=4096,
                response_format={"type": "json_object"}
            )
            
            # Extract AI response
            ai_response = response.choices[0].message.content
            
            try:
                # Parse the JSON response
                analysis_data = json.loads(ai_response)
                
                # Create structured result
                result = AnalysisResult(
                    error_summary=analysis_data.get("summary", ""),
                    detailed_feedback={
                        "strengths": analysis_data.get("feedback", {}).get("strengths", []),
                        "weaknesses": analysis_data.get("feedback", {}).get("weaknesses", []),
                        "suggestions": analysis_data.get("feedback", {}).get("suggestions", [])
                    },
                    confidence_score=float(analysis_data.get("confidence", 0.8)),
                    grade=float(analysis_data.get("grade", 5.0)),
                    cell_annotations=analysis_data.get("annotations", []),
                    error_highlights=analysis_data.get("error_highlights", [])
                )
                
                return result.model_dump()
                
            except Exception as e:
                logger.error(f"Error parsing OpenAI response: {str(e)}")
                raise ValueError(f"Error parsing OpenAI response: {str(e)}")
                
        except Exception as e:
            logger.error(f"OpenAI API call failed: {str(e)}")
            
            # Try alternative method
            alternative_result = call_openai_api_alternative(
                f"""
                # Reference Solution:
                ```python
                {reference_nb_repr[:5000]}...
                ```
                
                # Student Solution:
                ```python
                {student_nb_repr[:5000]}...
                ```
                
                {"The student solution contains {len(error_markers)} intentional errors marked with 'ОШИБКА' or 'ERROR'. Please find and explain these errors in detail." if error_markers else ""}
                
                Please analyze the student's solution against the reference solution and provide a detailed assessment.
                """
            )
            
            if alternative_result:
                logger.info("Alternative API call succeeded")
                
                # Create a more detailed fallback result if error markers were found
                if error_markers:
                    # Prepare error-focused feedback
                    weaknesses = []
                    for marker in error_markers:
                        weaknesses.append(f"Error in cell {marker['cell_index']}: {marker['error_description']}")
                    
                    return AnalysisResult(
                        error_summary=alternative_result.get("summary", f"Analysis identified {len(error_markers)} errors in the student solution."),
                        detailed_feedback={
                            "strengths": alternative_result.get("strengths", ["Some aspects of the solution show understanding of concepts"]),
                            "weaknesses": alternative_result.get("weaknesses", weaknesses),
                            "suggestions": alternative_result.get("suggestions", ["Correct the identified errors to improve your solution"])
                        },
                        confidence_score=alternative_result.get("confidence", 0.8),
                        grade=alternative_result.get("grade", max(7.0 - len(error_markers) * 0.5, 1.0)),  # Adjust grade based on error count
                        cell_annotations=[{"cell_index": marker["cell_index"], "comments": [marker["error_description"]]} for marker in error_markers],
                        error_highlights=[]
                    ).model_dump()
                else:
                    # Use the standard fallback
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
                    ).model_dump()
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
                "suggestions": ["Please try again or contact support", "Ensure your API key is valid"]
            },
            confidence_score=0.0,
            grade=0.0,
            cell_annotations=[],
            error_highlights=[]
        ).model_dump()

@app.post("/api/batch-analyze")
async def batch_analyze_notebooks():
    # Placeholder for batch analysis feature
    return {"message": "Batch analysis feature coming soon"}

def call_openai_api_alternative(prompt, model="gpt-4o"):
    """
    Alternative method to call OpenAI API using requests library directly.
    This bypasses the openai library which may have issues.
    """
    api_key = os.getenv("OPENAI_API_KEY")
    base_url = os.getenv("OPENAI_API_BASE") or "https://api.aiguoguo199.com/v1"
    
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
            {"role": "system", "content": "You are an AI assistant that analyzes Jupyter notebooks for mathematical problems. Pay special attention to errors marked with 'ОШИБКА' or 'ERROR' in the student code."},
            {"role": "user", "content": prompt + "\n\nPlease respond with a detailed analysis in JSON format with these fields: summary, strengths, weaknesses, suggestions, grade (0-10), and confidence (0-1)."}
        ],
        "temperature": 0.3,
        "response_format": {"type": "json_object"}
    }
    
    try:
        logger.info(f"Using alternative method to call OpenAI API with model: {model}")
        endpoint = f"{base_url}/chat/completions"
        # Make sure there's no double /v1 in the URL
        endpoint = endpoint.replace('/v1/v1/', '/v1/')
        logger.info(f"Making API request to endpoint: {endpoint}")
        
        response = requests.post(
            endpoint, 
            headers=headers,
            json=payload,
            timeout=30
        )
        
        if response.status_code == 200:
            result = response.json()
            content = result["choices"][0]["message"]["content"]
            logger.info(f"✅ Alternative method successful")
            
            try:
                # Try to parse the response as JSON
                json_response = json.loads(content)
                
                # Create a properly formatted response
                return {
                    "summary": json_response.get("summary", "Analysis completed with alternative method"),
                    "feedback": {
                        "strengths": json_response.get("strengths", ["Some understanding of the concepts demonstrated"]) 
                            if isinstance(json_response.get("strengths"), list) 
                            else [json_response.get("strengths", "Some understanding of the concepts demonstrated")],
                        "weaknesses": json_response.get("weaknesses", ["Detailed analysis unavailable"]) 
                            if isinstance(json_response.get("weaknesses"), list) 
                            else [json_response.get("weaknesses", "Detailed analysis unavailable")],
                        "suggestions": json_response.get("suggestions", ["Review your solution against the reference"]) 
                            if isinstance(json_response.get("suggestions"), list) 
                            else [json_response.get("suggestions", "Review your solution against the reference")]
                    },
                    "grade": float(json_response.get("grade", 7.0)),
                    "confidence": float(json_response.get("confidence", 0.7)),
                    "annotations": json_response.get("annotations", [])
                }
            except Exception as e:
                logger.error(f"Error parsing JSON response: {str(e)}")
                # If not valid JSON, create a simple structure
                return {
                    "summary": "Analysis completed with alternative method",
                    "feedback": {
                        "strengths": ["Some understanding of the concepts demonstrated"],
                        "weaknesses": ["Detailed analysis unavailable due to processing limitations"],
                        "suggestions": ["Review your solution against the reference"]
                    },
                    "grade": 7.0,
                    "confidence": 0.7
                }
        else:
            logger.error(f"❌ Alternative method failed with status {response.status_code}: {response.text}")
            return None
    except Exception as e:
        logger.error(f"❌ Alternative method exception: {str(e)}")
        return None

if __name__ == "__main__":
    port = int(os.getenv("PYTHON_SERVER_PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True) 