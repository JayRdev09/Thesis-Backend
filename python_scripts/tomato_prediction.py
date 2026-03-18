import numpy as np
import tensorflow as tf
from tensorflow.keras.models import load_model
from tensorflow.keras.preprocessing import image
import os
import json
import sys
import warnings
import time
import logging

# Configure logging to output to stderr
logging.basicConfig(level=logging.INFO, format='%(message)s', stream=sys.stderr)

# Set UTF-8 encoding for stdout
if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')

warnings.filterwarnings('ignore')

class TomatoClassifier:
    def __init__(self):
        """Initialize the tomato classifier with database-driven configurations"""
        try:
            logging.info("🚀 Initializing Tomato Disease Classifier...")
            
            script_dir = os.path.dirname(os.path.abspath(__file__))
            
            # 1. Load the model (similar to soil.py pattern)
            model_path = os.path.join(script_dir, 'models', 'plant_disease_mobilenetv2.h5')
            if not os.path.exists(model_path):
                model_path = os.path.join(script_dir, 'plant_disease_mobilenetv2.h5')
            
            logging.info(f"📂 Loading model from: {model_path}")
            self.model = load_model(model_path)
            logging.info("✅ MobileNetV2 model loaded successfully!")
            
            # 2. Load class names from JSON (local file, same as before)
            class_names_path = os.path.join(script_dir, 'models', 'class_names.json')
            if not os.path.exists(class_names_path):
                class_names_path = os.path.join(script_dir, 'class_names.json')
            
            logging.info(f"📂 Loading class names from: {class_names_path}")
            with open(class_names_path, 'r') as f:
                self.class_names = json.load(f)
            
            # Verify class names match model output
            self.num_classes = self.model.output_shape[-1]
            if len(self.class_names) != self.num_classes:
                logging.warning(f"⚠️ Warning: Class count mismatch!")
                if len(self.class_names) > self.num_classes:
                    self.class_names = self.class_names[:self.num_classes]
                else:
                    for i in range(len(self.class_names), self.num_classes):
                        self.class_names.append(f"Class_{i}")
            
            logging.info(f"✅ Loaded {len(self.class_names)} classes from JSON")
            
        except Exception as e:
            logging.error(f"❌ Classifier initialization failed: {e}")
            raise

    def _load_disease_recommendations_from_db(self, disease_recommendations_config):
        """Load disease recommendations from database configuration"""
        recommendations = {}
        
        # Use database-provided recommendations if available
        if disease_recommendations_config:
            for disease_name, recommendation_data in disease_recommendations_config.items():
                if isinstance(recommendation_data, dict):
                    recommendations[disease_name] = recommendation_data.get('recommendation', '')
                else:
                    recommendations[disease_name] = recommendation_data
        
        # Fallback to hardcoded recommendations if database doesn't have them
        if not recommendations:
            recommendations = self._get_fallback_recommendations()
            logging.warning("⚠️ Using fallback recommendations (database recommendations not provided)")
        
        logging.info(f"✅ Loaded {len(recommendations)} disease recommendations")
        return recommendations

    def _get_fallback_recommendations(self):
        """Fallback recommendations if database doesn't provide them"""
        return {
            'Tomato_Fruits_healthy': 'Continue regular monitoring. Maintain optimal growing conditions.',
            'Tomato_Leaves_healthy': 'Continue current care practices. Monitor weekly for early signs.',
            'Tomato_Fruits_Late_blight': 'Apply copper-based fungicide immediately. Remove infected fruits.',
            'Tomato_Leaves_Late_blight': 'Apply chlorothalonil or copper fungicide. Improve air circulation.',
            'Tomato_Fruits_Septoria_leaf_spot': 'Remove affected leaves. Apply fungicide containing copper.',
            'Tomato_Leaves_Septoria_leaf_spot': 'Prune affected foliage. Apply sulfur-based fungicide.',
            'Tomato_Fruits_Spider_mites': 'Apply insecticidal soap. Increase humidity around plants.',
            'Tomato_Leaves_Spider_mites': 'Use neem oil spray. Introduce predatory mites.',
            'Tomato_Fruits_Target_Spot': 'Apply fungicide. Ensure proper plant spacing.',
            'Tomato_Leaves_Target_Spot': 'Remove infected leaves. Apply chlorothalonil.',
            'Tomato_Fruits_Yellow_Leaf_Curl_Virus': 'Control whiteflies. Remove infected plants.',
            'Tomato_Leaves_Yellow_Leaf_Curl_Virus': 'Use reflective mulch. Apply insecticides for whiteflies.',
            'Tomato_Fruits_Bacterial_spot': 'Apply copper-based bactericide. Avoid overhead watering.',
            'Tomato_Leaves_Bacterial_spot': 'Remove infected leaves. Apply streptomycin if severe.',
            'Tomato_Fruits_Early_blight': 'Apply fungicide. Mulch around plants.',
            'Tomato_Leaves_Early_blight': 'Remove lower leaves. Apply chlorothalonil.',
            'Tomato_Fruits_Leaf_Mold': 'Improve ventilation. Apply sulfur-based fungicide.',
            'Tomato_Leaves_Leaf_Mold': 'Reduce humidity. Remove affected leaves.',
            'Tomato_Fruits_Mosaic_Virus': 'Control aphids. Remove infected plants.',
            'Tomato_Leaves_Mosaic_Virus': 'Disinfect tools. Plant resistant varieties.'
        }

    def preprocess_image(self, img_path, target_size=(224, 224)):
        """Preprocess image exactly like during training"""
        try:
            logging.info(f"📷 Loading image: {os.path.basename(img_path)}")
            
            if not os.path.exists(img_path):
                raise FileNotFoundError(f"Image not found: {img_path}")
            
            img = image.load_img(img_path, target_size=target_size)
            img_array = image.img_to_array(img)
            img_array = img_array / 255.0
            img_array = np.expand_dims(img_array, axis=0)
            
            logging.info(f"✅ Image preprocessed: shape={img_array.shape}")
            return img_array
            
        except Exception as e:
            logging.error(f"❌ Error preprocessing image: {e}")
            raise

    def get_tomato_type(self, class_name):
        """Determine if it's leaf, fruit, or non-tomato based on class name"""
        if class_name is None:
            return None
            
        class_lower = class_name.lower()
        
        if 'fruits' in class_lower:
            return "Fruit"
        elif 'leaves' in class_lower:
            return "Leaf"
        elif 'not_tomato' in class_lower:
            return None
        else:
            if 'tomato' in class_lower:
                return "Leaf"
            return None

    def is_tomato(self, tomato_type):
        """Check if the prediction is tomato-related"""
        return tomato_type in ["Leaf", "Fruit"]

    def calculate_model_confidence(self, predictions, predicted_class_idx):
        """Calculate model confidence similar to soil.py"""
        try:
            # For neural networks, we can use prediction probability as confidence
            confidence = float(predictions[0][predicted_class_idx])
            
            # Additional confidence calculation could be added here
            # For example, checking the difference between top predictions
            
            logging.info(f"Model confidence: {confidence:.3f}")
            return confidence
            
        except Exception as e:
            logging.error(f"FATAL: Confidence calculation failed: {e}")
            raise ValueError(f"Cannot calculate confidence: {str(e)}")

    def get_health_status(self, class_name, confidence, health_thresholds):
        """Determine overall health status based on database thresholds"""
        if class_name is None:
            return None
            
        class_lower = class_name.lower()
        
        # Use database thresholds for health categorization
        if 'healthy' in class_lower and confidence > health_thresholds.get('healthy_threshold', 0.5):
            return "Healthy"
        else:
            # Check if this disease has a specific severity in thresholds
            for disease_pattern, severity in health_thresholds.get('disease_severities', {}).items():
                if disease_pattern.lower() in class_lower:
                    return severity
            
            # Fallback logic based on keywords
            if any(keyword in class_lower for keyword in health_thresholds.get('moderate_keywords', ['early', 'mild', 'minor', 'spot'])):
                return "Moderate"
            elif any(keyword in class_lower for keyword in health_thresholds.get('critical_keywords', ['late', 'severe', 'rot', 'blight', 'mosaic', 'virus'])):
                return "Critical"
            else:
                return "Unhealthy"

    def calculate_plant_health_score(self, class_name, confidence, tomato_type, scoring_config):
        """Calculate numerical plant health score (0-100) using database scoring configuration"""
        if not self.is_tomato(tomato_type) or class_name is None:
            return None
            
        class_lower = class_name.lower()
        
        # Use scoring configuration from database
        base_scores = scoring_config.get('base_scores', {
            'healthy': 95,
            'moderate': 70,
            'critical': 25,
            'default': 45
        })
        
        # Determine base score based on health status
        if 'healthy' in class_lower:
            base_score = base_scores['healthy']
        else:
            # Check disease patterns from scoring config
            disease_patterns = scoring_config.get('disease_patterns', {})
            for pattern, score in disease_patterns.items():
                if pattern.lower() in class_lower:
                    base_score = score
                    break
            else:
                # Use severity-based scoring
                if any(keyword in class_lower for keyword in scoring_config.get('moderate_keywords', ['early', 'mild', 'minor'])):
                    base_score = base_scores['moderate']
                elif any(keyword in class_lower for keyword in scoring_config.get('critical_keywords', ['late', 'severe', 'rot', 'blight', 'mosaic', 'virus'])):
                    base_score = base_scores['critical']
                else:
                    base_score = base_scores['default']
        
        # Adjust score based on prediction confidence using configurable adjustment
        confidence_adjustment_factor = scoring_config.get('confidence_adjustment_factor', 30)
        confidence_adjustment = (confidence - 0.5) * confidence_adjustment_factor
        adjusted_score = base_score + confidence_adjustment
        
        # Clamp score to min/max from config
        min_score = scoring_config.get('min_score', 0)
        max_score = scoring_config.get('max_score', 100)
        final_score = max(min_score, min(max_score, adjusted_score))
        
        return round(final_score, 1)

    def get_disease_type(self, class_name, tomato_type):
        """Extract specific disease type from class name"""
        if not self.is_tomato(tomato_type) or class_name is None:
            return None
            
        disease_name = class_name
        
        if 'Tomato_Fruits_' in disease_name:
            disease_name = disease_name.replace('Tomato_Fruits_', '')
        elif 'Tomato_Leaves_' in disease_name:
            disease_name = disease_name.replace('Tomato_Leaves_', '')
        
        disease_name = disease_name.replace('Tomato__', '').replace('_', ' ').title()
        disease_name = disease_name.replace('Two Spotted Spider Mite', 'Spider Mites')
        disease_name = disease_name.replace('Yellow Leaf  Curl Virus', 'Yellow Leaf Curl Virus')
        disease_name = disease_name.replace('Late Blight Tomato Healthy', 'Late Blight')
        
        return disease_name.strip()

    def get_recommendations(self, class_name, tomato_type, health_status, disease_recommendations, config, low_confidence=False):
        """Generate recommendations based on database configuration"""
        if low_confidence:
            return config.get('low_confidence_recommendations', [
                "The model is not confident about this prediction.",
                "Please upload a clearer image of a tomato leaf or fruit.",
                "Ensure the image is well-lit and focused on the plant part.",
                "Try taking the photo from a closer distance.",
                "Make sure the background is not too cluttered."
            ])
            
        recommendations = []
        
        # Get recommendation from database dictionary
        if class_name in disease_recommendations:
            recommendation_text = disease_recommendations[class_name]
            rec_list = recommendation_text.split('. ')
            recommendations = [rec.strip() + '.' for rec in rec_list if rec.strip()]
            logging.info(f"✅ Using database recommendations for: {class_name}")
        else:
            # Fallback using config
            if not self.is_tomato(tomato_type):
                recommendations = config.get('non_tomato_recommendations', [
                    "This does not appear to be a tomato plant.",
                    "Please upload clear images of tomato leaves or fruits.",
                    "Ensure proper identification of the plant."
                ])
            else:
                disease_name = self.get_disease_type(class_name, tomato_type)
                status_config = config.get('health_status_recommendations', {})
                
                if health_status in status_config:
                    recommendations = status_config[health_status]
                else:
                    # Default recommendations based on health status
                    if health_status == "Healthy":
                        recommendations = [
                            "Continue current care practices.",
                            "Monitor plants weekly for early signs.",
                            "Maintain optimal growing conditions."
                        ]
                    elif health_status == "Moderate":
                        recommendations = [
                            f"Address {disease_name or 'the issue'} promptly.",
                            "Remove affected plant parts.",
                            "Apply appropriate treatment."
                        ]
                    elif health_status == "Critical":
                        recommendations = [
                            f"URGENT: Treat {disease_name or 'the disease'} immediately.",
                            "Remove severely infected plants.",
                            "Consult agriculture expert."
                        ]
                    else:
                        recommendations = [
                            f"Address {disease_name or 'the issue'}.",
                            "Improve plant health conditions.",
                            "Seek expert advice if needed."
                        ]
        
        return recommendations[:config.get('max_recommendations', 6)]

    def predict_disease(self, img_path, tomato_config):
        """Make disease prediction using database configuration like soil.py"""
        try:
            start_time = time.time()
            
            logging.info(f"🔍 Processing image: {os.path.basename(img_path)}")
            
            # Get confidence threshold from config
            confidence_threshold = tomato_config.get('confidence_threshold', 0.3)
            logging.info(f"📊 Using confidence threshold from config: {confidence_threshold}")
            
            # 1. Preprocess image
            img_array = self.preprocess_image(img_path, target_size=(224, 224))
            
            # 2. Make prediction
            logging.info("🤖 Running model prediction...")
            predictions = self.model.predict(img_array, verbose=0)
            predicted_class_idx = np.argmax(predictions[0])
            confidence = float(predictions[0][predicted_class_idx])
            
            # 3. Get predicted class name
            if predicted_class_idx < len(self.class_names):
                predicted_class = self.class_names[predicted_class_idx]
                logging.info(f"🎯 TOP PREDICTION: {predicted_class} (confidence: {confidence:.4f})")
            else:
                predicted_class = f"Class_{predicted_class_idx}"
                logging.error(f"❌ ERROR: Class index {predicted_class_idx} out of range!")
                return None
            
            # 4. Calculate model confidence
            model_confidence = self.calculate_model_confidence(predictions, predicted_class_idx)
            
            # 5. CHECK CONFIDENCE THRESHOLD (using database config)
            low_confidence = False
            if confidence < confidence_threshold:
                low_confidence = True
                logging.warning(f"⚠️ Low confidence prediction: {confidence:.4f} < {confidence_threshold}")
                logging.warning("   Returning uncertain prediction result")
                
                inference_time = time.time() - start_time
                
                return {
                    'success': True,
                    'predicted_class': predicted_class,
                    'confidence': confidence,
                    'model_confidence': model_confidence,
                    'is_tomato': False,
                    'tomato_type': None,
                    'health_status': None,
                    'plant_health_score': None,
                    'disease_type': None,
                    'recommendations': self.get_recommendations(
                        predicted_class, None, None, 
                        {}, tomato_config.get('recommendation_config', {}), low_confidence=True
                    ),
                    'inference_time': inference_time,
                    'plant_type': "Uncertain",
                    'low_confidence': True,
                    'confidence_threshold': confidence_threshold,
                    'config_source': 'database'
                }
            
            # 6. Get top predictions for analysis
            sorted_indices = np.argsort(predictions[0])[::-1]
            top_predictions = []
            
            for idx in sorted_indices[:3]:
                if idx < len(self.class_names):
                    class_name = self.class_names[idx]
                else:
                    class_name = f"Class_{idx}"
                
                top_predictions.append({
                    'class': class_name,
                    'confidence': float(predictions[0][idx])
                })
            
            # 7. Determine tomato type
            tomato_type = self.get_tomato_type(predicted_class)
            is_tomato = self.is_tomato(tomato_type)
            
            # 8. Load recommendations from database config
            disease_recommendations = self._load_disease_recommendations_from_db(
                tomato_config.get('disease_recommendations', {})
            )
            
            # 9. Calculate additional information using database config
            if is_tomato:
                health_status = self.get_health_status(
                    predicted_class, 
                    confidence, 
                    tomato_config.get('health_thresholds', {})
                )
                
                disease_type = self.get_disease_type(predicted_class, tomato_type)
                
                plant_health_score = self.calculate_plant_health_score(
                    predicted_class, 
                    confidence, 
                    tomato_type,
                    tomato_config.get('scoring_config', {})
                )
                
                recommendations = self.get_recommendations(
                    predicted_class, 
                    tomato_type, 
                    health_status,
                    disease_recommendations,
                    tomato_config.get('recommendation_config', {}),
                    low_confidence=False
                )
                
                logging.info(f"🍅 Tomato {tomato_type.lower()} detected: {predicted_class}")
                logging.info(f"🏥 Health Status: {health_status}")
                logging.info(f"📈 Plant Health Score: {plant_health_score}/100")
                logging.info(f"🦠 Disease Type: {disease_type}")
            else:
                health_status = None
                disease_type = None
                plant_health_score = None
                recommendations = self.get_recommendations(
                    predicted_class, 
                    tomato_type, 
                    None,
                    disease_recommendations,
                    tomato_config.get('recommendation_config', {}),
                    low_confidence=False
                )
                
                logging.info(f"🚫 Non-tomato detected: {predicted_class}")
            
            inference_time = time.time() - start_time
            logging.info(f"⏱️ Inference time: {inference_time:.2f} seconds")
            logging.info(f"💡 Recommendations generated: {len(recommendations)}")
            logging.info(f"⚙️ Configuration source: Database")
            
            return {
                'success': True,
                'predicted_class': predicted_class,
                'confidence': confidence,
                'model_confidence': model_confidence,
                'is_tomato': is_tomato,
                'tomato_type': tomato_type,
                'health_status': health_status,
                'plant_health_score': plant_health_score,
                'disease_type': disease_type,
                'recommendations': recommendations,
                'top_predictions': top_predictions,
                'inference_time': inference_time,
                'plant_type': "Tomato" if is_tomato else "Non-Tomato",
                'low_confidence': False,
                'confidence_threshold': confidence_threshold,
                'config_source': 'database'
            }
            
        except Exception as e:
            logging.error(f"❌ Error predicting disease: {e}")
            import traceback
            logging.error(traceback.format_exc())
            return {
                'success': False,
                'error': f"Prediction failed: {str(e)}"
            }

    def analyze_tomato(self, image_path, tomato_config):
        """Main analysis method like soil.py's analyze_soil"""
        start_time = time.time()
        try:
            logging.info("🌱 Making tomato disease prediction...")
            
            if not os.path.exists(image_path):
                return {
                    'success': False,
                    'error': f'Image file not found: {image_path}'
                }
            
            # Perform prediction using database configuration
            result = self.predict_disease(image_path, tomato_config)
            
            if not result['success']:
                return result
            
            inference_time = time.time() - start_time
            
            logging.info(f"Tomato analysis complete: {result.get('predicted_class', 'Unknown')}")
            
            # Return result in same format as soil.py
            return {
                'success': True,
                'predicted_class': result.get('predicted_class'),
                'tomato_type': result.get('tomato_type'),
                'health_status': result.get('health_status'),
                'disease_type': result.get('disease_type'),
                'confidence_score': result.get('confidence'),
                'model_confidence': result.get('model_confidence'),
                'plant_health_score': result.get('plant_health_score'),
                'recommendations': result.get('recommendations'),
                'top_predictions': result.get('top_predictions'),
                'inference_time': inference_time,
                'is_tomato': result.get('is_tomato'),
                'plant_type': result.get('plant_type'),
                'low_confidence': result.get('low_confidence', False),
                'confidence_threshold': result.get('confidence_threshold'),
                'config_source': result.get('config_source', 'database')
            }
            
        except Exception as e:
            logging.error(f"Tomato analysis error: {e}")
            import traceback
            traceback.print_exc()
            return {
                'success': False,
                'error': f"Tomato analysis failed: {str(e)}"
            }

def main():
    """Main function for tomato disease identification - follows soil.py pattern"""
    try:
        # FIX: Read from stdin instead of command line argument
        if len(sys.argv) > 1:
            # For backward compatibility, still support command line args
            input_data = json.loads(sys.argv[1])
            logging.warning("Using command line argument (deprecated - may cause ENAMETOOLONG)")
        else:
            # Read from stdin
            input_data = json.loads(sys.stdin.read())
        
        image_path = input_data.get('image_path')
        tomato_config = input_data.get('tomato_config', {})
        user_id = input_data.get('user_id', 'unknown')
        image_id = input_data.get('image_id', 'unknown')
        
        logging.info(f"👤 Analyzing tomato for user: {user_id}")
        
        if not image_path:
            result = {
                'success': False,
                'error': 'No image path provided'
            }
            print(json.dumps(result))
            return
        
        if not tomato_config:
            result = {
                'success': False,
                'error': 'No tomato configuration provided from database'
            }
            print(json.dumps(result))
            return
        
        # Initialize classifier
        classifier = TomatoClassifier()
        
        # Perform analysis using database configuration
        result = classifier.analyze_tomato(image_path, tomato_config)
        result['user_id'] = user_id
        result['image_id'] = image_id
        
        logging.info(f"Tomato prediction completed for user: {user_id}")
        print(json.dumps(result, default=str))
        
    except Exception as e:
        result = {
            'success': False,
            'error': f"Tomato prediction failed: {str(e)}"
        }
        print(json.dumps(result))

if __name__ == "__main__":
    main()