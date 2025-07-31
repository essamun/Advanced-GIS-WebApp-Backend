import os
from flask import Flask, jsonify, send_from_directory, request
import psycopg2
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__, static_folder='static', template_folder='templates')

# Database connection
def get_conn():
    try:
        return psycopg2.connect(
            host=os.getenv('DB_HOST'),
            dbname=os.getenv('DB_NAME'),
            user=os.getenv('DB_USER'),
            password=os.getenv('DB_PASSWORD'),
            port=os.getenv('DB_PORT', '5432')
        )
    except psycopg2.Error as e:
        print(f"Database connection error: {e}")
        raise

# GeoJSON data fetcher
def fetch_geojson(table_name):
    conn = get_conn()
    cur = conn.cursor()
    try:
        sql = f"""
            SELECT jsonb_build_object(
                'type', 'FeatureCollection',
                'features', jsonb_agg(
                    jsonb_build_object(
                        'type', 'Feature',
                        'geometry', ST_AsGeoJSON(wkb_geometry)::jsonb,
                        'properties', to_jsonb(row) - 'wkb_geometry'
                    )
                )
            )
            FROM (SELECT * FROM {table_name}) row;
        """
        cur.execute(sql)
        return cur.fetchone()[0]
    finally:
        cur.close()
        conn.close()

# Frontend routes
@app.route('/')
def serve_index():
    return send_from_directory('templates', 'index.html')

@app.route('/<path:path>')
def serve_static(path):
    return send_from_directory('static', path)

# API routes
@app.route('/api/<layer_name>')
def api_layer(layer_name):
    return jsonify(fetch_geojson(layer_name))

@app.route('/api/business/add', methods=['POST'])
def add_business():
    data = request.get_json()
    if not all(k in data for k in ['name', 'type', 'lat', 'lng']):
        return jsonify({'error': 'Missing required fields'}), 400
    
    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute("""
            INSERT INTO business (name, type, wkb_geometry)
            VALUES (%s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326))
            RETURNING ogc_fid, name, type, ST_AsGeoJSON(wkb_geometry)::json
            """, 
            (data['name'], data['type'], data['lng'], data['lat'])
        )
        result = cur.fetchone()
        conn.commit()
        
        return jsonify({
            "type": "Feature",
            "geometry": result[3],
            "properties": {
                "ogc_fid": result[0],
                "name": result[1],
                "type": result[2]
            }
        }), 201
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/business/update/<int:business_id>', methods=['PUT'])
def update_business(business_id):
    data = request.get_json()
    if not all(k in data for k in ['name', 'type']):
        return jsonify({'error': 'Missing required fields'}), 400
    
    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute("""
            UPDATE business 
            SET name = %s, type = %s
            WHERE ogc_fid = %s
            RETURNING ogc_fid, name, type, ST_AsGeoJSON(wkb_geometry)::json
            """,
            (data['name'], data['type'], business_id)
        )
        if cur.rowcount == 0:
            return jsonify({'error': 'Business not found'}), 404
            
        result = cur.fetchone()
        conn.commit()
        return jsonify({
            "type": "Feature",
            "geometry": result[3],
            "properties": {
                "ogc_fid": result[0],
                "name": result[1],
                "type": result[2]
            }
        })
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

@app.route('/api/business/delete/<int:business_id>', methods=['DELETE'])
def delete_business(business_id):
    conn = get_conn()
    cur = conn.cursor()
    try:
        cur.execute("SELECT ogc_fid FROM business WHERE ogc_fid = %s", (business_id,))
        if not cur.fetchone():
            return jsonify({'error': 'Business not found'}), 404
            
        cur.execute("DELETE FROM business WHERE ogc_fid = %s", (business_id,))
        conn.commit()
        return jsonify({'success': True})
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        cur.close()
        conn.close()

# Vercel requires this for serverless functions
@app.route('/api/vercel')
def vercel_handler():
    return jsonify({'status': 'ready'})

if __name__ == '__main__':
    app.run(debug=True)